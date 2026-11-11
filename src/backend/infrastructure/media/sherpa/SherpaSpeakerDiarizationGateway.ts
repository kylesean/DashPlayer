import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { injectable } from 'inversify';

import { getMainLogger } from '@/backend/infrastructure/logger';
import type SpeakerDiarizationGateway from '@/backend/services/gateways/media/SpeakerDiarizationGateway';
import {
    type SpeakerDiarizationRequest,
    type SpeakerDiarizationResult,
    type SpeakerSegment,
} from '@/backend/services/gateways/media/SpeakerDiarizationGateway';
import {
    DIARIZATION_EMBEDDING_DIRECTORY,
    DIARIZATION_EMBEDDING_FILE,
    DIARIZATION_SEGMENTATION_DIRECTORY,
    DIARIZATION_SEGMENTATION_FILE,
} from '@/backend/services/models/speakerDiarizationModel';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import { LOG_TAIL_LINES, OutputTail, tailLines } from '@/backend/utils/output-tail';
import { getRuntimeResourcePath } from '@/backend/utils/runtimeEnv';

/** 未知说话人数量时的聚类阈值；越大越少簇（人越少），0.5 是官方默认。 */
const DEFAULT_CLUSTER_THRESHOLD = 0.5;

/** 单段最短时长；过短的噪声段会制造假换人，按官方默认丢弃。 */
const MIN_DURATION_ON = 0.3;

/** 同一说话人相邻段的合并间隔；小于该值的停顿不算换人。 */
const MIN_DURATION_OFF = 0.5;

/** 分段行匹配：`0.318 -- 6.865 speaker_00`。 */
const SEGMENT_LINE = /^\s*([\d.]+)\s*--\s*([\d.]+)\s+(\S+)\s*$/u;

/**
 * 基于 sherpa-onnx 离线说话人分离 CLI 的本地实现。
 *
 * 只做进程管理与输出解析：模型选择、聚类参数都在这里固定，调用方无需了解
 * CLI 细节。分离是 CPU 密集型但可离线，长视频按 RTF ≈ 0.15 估算耗时可接受。
 */
@injectable()
export class SherpaSpeakerDiarizationGateway implements SpeakerDiarizationGateway {
    private readonly logger = getMainLogger('SherpaSpeakerDiarization');

    /** job 键 → 正在运行的分离子进程集合。 */
    private readonly activeProcesses = new Map<string, Set<ChildProcess>>();

    /**
     * 解析当前平台随应用分发的分离 CLI。
     * @returns 可执行文件绝对路径。
     */
    public resolveExecutablePath(): string {
        const platformDir = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
        const archDir = process.arch === 'arm64' ? 'arm64' : 'x64';
        const executableName = process.platform === 'win32'
            ? 'sherpa-onnx-offline-speaker-diarization.exe'
            : 'sherpa-onnx-offline-speaker-diarization';
        const executablePath = getRuntimeResourcePath('lib', 'sherpa-onnx', archDir, platformDir, executableName);
        if (!fs.existsSync(executablePath)) {
            throw new Error(`sherpa-onnx 说话人分离可执行文件不存在：${executablePath}`);
        }
        return executablePath;
    }

    /**
     * 分离一个音频文件的说话人。
     * @param request 音频、模型与生命周期参数。
     * @returns 分段列表与说话人数量。
     */
    public async diarize(request: SpeakerDiarizationRequest): Promise<SpeakerDiarizationResult> {
        if (request.isCancelled?.()) {
            throw new CancelByUserError('Speaker diarization cancelled by user');
        }
        const executablePath = this.resolveExecutablePath();
        const segmentationModel = path.join(
            request.modelsRoot,
            DIARIZATION_SEGMENTATION_DIRECTORY,
            DIARIZATION_SEGMENTATION_FILE,
        );
        const embeddingModel = path.join(
            request.modelsRoot,
            DIARIZATION_EMBEDDING_DIRECTORY,
            DIARIZATION_EMBEDDING_FILE,
        );
        for (const [name, modelPath] of [['分割', segmentationModel], ['声纹嵌入', embeddingModel]] as const) {
            if (!fs.existsSync(modelPath)) {
                throw new Error(`说话人分离${name}模型缺失：${modelPath}`);
            }
        }

        const processKey = request.job ?? '';
        let runningChild: ChildProcess | null = null;
        try {
            return await new Promise<SpeakerDiarizationResult>((resolve, reject) => {
                const child = spawn(executablePath, [
                    `--segmentation.pyannote-model=${segmentationModel}`,
                    `--embedding.model=${embeddingModel}`,
                    `--clustering.cluster-threshold=${DEFAULT_CLUSTER_THRESHOLD}`,
                    `--min-duration-on=${MIN_DURATION_ON}`,
                    `--min-duration-off=${MIN_DURATION_OFF}`,
                    request.audioPath,
                ], {
                    cwd: path.dirname(executablePath),
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
                runningChild = child;
                const procSet = this.activeProcesses.get(processKey) ?? new Set<ChildProcess>();
                procSet.add(child);
                this.activeProcesses.set(processKey, procSet);
                this.logger.info('spawned speaker diarization', {
                    job: request.job,
                    pid: child.pid,
                    audioPath: request.audioPath,
                });

                // 分段行混在进度输出里，stderr 用环形缓冲；stdout 也全文累积后统一解析。
                let stdout = '';
                const stderr = new OutputTail();
                child.stdout.on('data', (chunk) => { stdout += String(chunk); });
                child.stderr.on('data', (chunk) => { stderr.push(String(chunk)); });
                const heartbeat = setInterval(() => {
                    if (!request.isCancelled?.()) request.onHeartbeat?.();
                }, 4000);

                child.on('error', (error) => {
                    clearInterval(heartbeat);
                    this.logger.error('speaker diarization spawn failed', {
                        job: request.job,
                        pid: child.pid,
                        error,
                    });
                    reject(error);
                });
                child.on('close', (code, signal) => {
                    clearInterval(heartbeat);
                    if (request.isCancelled?.()) {
                        this.logger.warn('speaker diarization cancelled', {
                            job: request.job,
                            pid: child.pid,
                            exitCode: code,
                            signal,
                        });
                        reject(new CancelByUserError('Speaker diarization cancelled by user'));
                        return;
                    }
                    if (code !== 0) {
                        const exitReason = signal ? `被信号 ${signal} 终止` : `退出码 ${code}`;
                        this.logger.error('speaker diarization exited abnormally', {
                            job: request.job,
                            pid: child.pid,
                            exitCode: code,
                            signal,
                            stderrTail: stderr.logTail(),
                            stdoutTail: tailLines(stdout, LOG_TAIL_LINES),
                        });
                        reject(new Error(`sherpa-onnx 说话人分离 ${exitReason}：${stderr.bufferedText()}`));
                        return;
                    }
                    try {
                        resolve(parseDiarizationOutput(`${stdout}\n${stderr.bufferedText()}`));
                    } catch (error) {
                        this.logger.error('speaker diarization output rejected', {
                            job: request.job,
                            pid: child.pid,
                            error,
                            stdoutTail: tailLines(stdout, LOG_TAIL_LINES),
                        });
                        reject(error);
                    }
                });
            });
        } finally {
            if (runningChild) {
                const procSet = this.activeProcesses.get(processKey);
                if (procSet) {
                    procSet.delete(runningChild);
                    if (procSet.size === 0) {
                        this.activeProcesses.delete(processKey);
                    }
                }
            }
        }
    }

    /**
     * 终止指定 job 的分离进程；未指定 job 时终止全部活动进程。
     * @param job 目标任务的 job 标识。
     */
    public cancelActive(job?: string): void {
        if (job !== undefined) {
            const targets: ChildProcess[] = [];
            for (const [key, procSet] of this.activeProcesses.entries()) {
                if (key === job || key.startsWith(`${job}:`)) {
                    targets.push(...procSet);
                    this.activeProcesses.delete(key);
                }
            }
            for (const child of targets) {
                child.kill('SIGKILL');
            }
            return;
        }
        for (const procSet of this.activeProcesses.values()) {
            for (const child of procSet) {
                child.kill('SIGKILL');
            }
        }
        this.activeProcesses.clear();
    }
}

/**
 * 解析 CLI 输出中的分段行。
 *
 * 进度、耗时与配置回显混在同一份输出里，只接受严格匹配
 * `start -- end speaker_XX` 的行；没有任何分段行时返回空结果，而不是报错——
 * 纯音乐或静音视频本来就该是零说话人。
 *
 * @param output CLI 的 stdout 与 stderr 合并文本。
 * @returns 按开始时间升序的分段与说话人数量。
 */
export function parseDiarizationOutput(output: string): SpeakerDiarizationResult {
    const segments: SpeakerSegment[] = [];
    for (const line of output.split(/\r?\n/u)) {
        const match = SEGMENT_LINE.exec(line);
        if (!match) continue;
        const start = Number.parseFloat(match[1]);
        const end = Number.parseFloat(match[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        segments.push({ start, end, speaker: match[3] });
    }
    segments.sort((left, right) => left.start - right.start || left.end - right.end);
    return {
        segments,
        speakerCount: new Set(segments.map((segment) => segment.speaker)).size,
    };
}
