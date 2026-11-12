import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inject, injectable } from 'inversify';

import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import type FfmpegService from '@/backend/services/FfmpegService';
import type MediaSignalRepository from '@/backend/services/repositories/MediaSignalRepository';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type { SceneSentence } from '@/common/learning/sceneSegmentation';
import {
    analyzeSentencesProsody,
    buildEnergyEnvelope,
    detectProsodyShifts,
    PROSODY_ENVELOPE_SEC,
    type ProsodyShift,
} from '@/common/learning/prosodySignal';
import { decodePcm16Wav } from '@/common/utils/practice/rhythmFeedback';

/**
 * 语音韵律信号的算法版本。
 *
 * 阈值、包络分辨率或输出结构变化时递增：持久化信号按
 * `videoId + kind + 版本` 唯一，版本变了旧结果自然失效并重算。
 */
export const PROSODY_SIGNAL_VERSION = 1;

/** 信号类型标识；与 `dp_media_signal.kind` 一致。 */
export const PROSODY_SIGNAL_KIND = 'prosody-envelope';

/** 持久化载荷：整段能量包络 + 分辨率。 */
interface ProsodyPayload {
    frameSec: number;
    envelope: number[];
}

/**
 * 语音韵律场景信号服务契约。
 */
export default interface ProsodySignalService {
    /**
     * 读取或计算某个视频的韵律突变点。
     *
     * 视频无音轨、解码失败或音频全程静音时返回 `null`，调用方降级为
     * 其余信号。
     *
     * @param videoPath 视频文件绝对路径。
     * @param sentences 用于对齐的字幕句。
     * @returns 按时间升序的韵律突变点；不可用时为 `null`。
     */
    getShifts(
        videoPath: string,
        sentences: readonly SceneSentence[],
    ): Promise<ProsodyShift[] | null>;

    /**
     * 删除某个视频的韵律信号缓存。
     * @param videoPath 视频文件绝对路径。
     * @returns 删除的行数。
     */
    invalidate(videoPath: string): Promise<number>;
}

/**
 * 基于本地音频能量的韵律场景信号服务。
 *
 * 流程：抽取 16kHz 单声道 WAV → 生成 dBFS 能量包络 → 按句统计语速与音量 →
 * 找相邻句之间的突变。结果按视频持久化：解码整部音频的代价远高于字幕
 * 启发式，不能每次进播放页都重跑。
 *
 * 不调用 ASR、不做音素级分析：这里要的是「说话方式变没变」，而不是说了
 * 什么。因此它与跟读环节的韵律反馈共用同一套解码与能量口径，但用途不同。
 */
@injectable()
export class ProsodySignalServiceImpl implements ProsodySignalService {
    private readonly logger = getMainLogger('ProsodySignalService');
    private readonly inFlight = new Map<string, Promise<ProsodyShift[] | null>>();

    public constructor(
        @inject(TYPES.FfmpegService) private readonly ffmpegService: FfmpegService,
        @inject(TYPES.MediaSignalRepository) private readonly repository: MediaSignalRepository,
        @inject(TYPES.StorageDirectoryProvider)
        private readonly directories: StorageDirectoryProvider,
    ) {}

    public async getShifts(
        videoPath: string,
        sentences: readonly SceneSentence[],
    ): Promise<ProsodyShift[] | null> {
        if (sentences.length < 2) {
            return [];
        }
        const inputHash = await videoInputHash(videoPath);
        if (!inputHash) {
            return null;
        }
        try {
            const cached = await this.repository.find(videoPath, PROSODY_SIGNAL_KIND, PROSODY_SIGNAL_VERSION);
            if (cached && cached.input_hash === inputHash) {
                const payload = parsePayload(cached.payload_json);
                if (payload) {
                    return shiftsFromPayload(payload, sentences);
                }
                this.logger.warn('prosody payload invalid, recomputing', { videoPath });
            }
        } catch (error) {
            this.logger.warn('prosody signal read skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        const existing = this.inFlight.get(videoPath);
        if (existing) {
            return existing;
        }
        const task = this.compute(videoPath, inputHash, sentences);
        this.inFlight.set(videoPath, task);
        try {
            return await task;
        } finally {
            this.inFlight.delete(videoPath);
        }
    }

    public async invalidate(videoPath: string): Promise<number> {
        try {
            return await this.repository.deleteByVideo(videoPath);
        } catch (error) {
            this.logger.warn('prosody signal invalidate skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
            return 0;
        }
    }

    /**
     * 执行一次解码 + 包络 + 突变检测，并持久化包络。
     *
     * 任何失败都返回 `null`：韵律是场景提示的增强信号，缺音轨或解码失败
     * 不应该让播放页报错。
     */
    private async compute(
        videoPath: string,
        inputHash: string,
        sentences: readonly SceneSentence[],
    ): Promise<ProsodyShift[] | null> {
        const tempDirectory = await this.directories.provideDirectory(StorageDirectoryTarget.TEMP);
        const wavPath = path.join(
            tempDirectory,
            `prosody-${createHash('sha1').update(videoPath).digest('hex')}.wav`,
        );
        try {
            await this.ffmpegService.convertToWav(videoPath, wavPath);
            const pcm = decodePcm16Wav(await fs.promises.readFile(wavPath));
            if (!pcm) {
                return null;
            }
            const envelope = buildEnergyEnvelope({
                samples: pcm.samples,
                sampleRate: pcm.sampleRate,
                bucketSec: PROSODY_ENVELOPE_SEC,
            });
            if (envelope.length === 0) {
                return null;
            }
            const payload: ProsodyPayload = { frameSec: PROSODY_ENVELOPE_SEC, envelope };
            const shifts = shiftsFromPayload(payload, sentences);
            try {
                await this.repository.upsert({
                    videoId: videoPath,
                    kind: PROSODY_SIGNAL_KIND,
                    algorithmVersion: PROSODY_SIGNAL_VERSION,
                    inputHash,
                    payloadJson: JSON.stringify(payload),
                });
            } catch (error) {
                // 写入失败只影响下次是否重算，不影响本次结果。
                this.logger.warn('prosody signal write skipped', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            return shifts;
        } catch (error) {
            this.logger.warn('prosody signal skipped', {
                videoPath,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        } finally {
            // WAV 中间产物体积可观（每分钟约 1.8 MB），无论成败都要删。
            try {
                await fs.promises.rm(wavPath, { force: true });
            } catch {
                // 清理失败不影响结果。
            }
        }
    }
}

/**
 * 从持久化载荷重算逐句特征与突变点。
 *
 * 包络是跨会话复用的部分，逐句特征不持久化：它依赖当前字幕句的切分，
 * 而字幕可能被重新校对或微调时间，缓存逐句结果只会带来失效难题。
 *
 * @param payload 持久化载荷。
 * @param sentences 当前字幕句。
 * @returns 韵律突变点。
 */
function shiftsFromPayload(
    payload: ProsodyPayload,
    sentences: readonly SceneSentence[],
): ProsodyShift[] {
    const signals = analyzeSentencesProsody({
        envelope: payload.envelope,
        frameSec: payload.frameSec,
        sentences,
    });
    return detectProsodyShifts(signals);
}

/**
 * 计算视频文件的输入指纹：路径 + 大小 + 修改时间。
 *
 * @param videoPath 视频文件绝对路径。
 * @returns 十六进制 SHA-256；文件不可读时为 null。
 */
async function videoInputHash(videoPath: string): Promise<string | null> {
    try {
        const stat = await fs.promises.stat(videoPath);
        return createHash('sha256')
            .update(`${videoPath}\u001f${stat.size}\u001f${stat.mtimeMs}`)
            .digest('hex');
    } catch {
        return null;
    }
}

/**
 * 校验并解析持久化的能量包络。
 *
 * @param json 持久化的 JSON 文本。
 * @returns 合法载荷；结构不合法时为 null。
 */
function parsePayload(json: string): ProsodyPayload | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null;
    }
    const record = parsed as Record<string, unknown>;
    const { frameSec, envelope } = record;
    if (
        typeof frameSec !== 'number'
        || !Number.isFinite(frameSec)
        || frameSec <= 0
        || !Array.isArray(envelope)
        || envelope.length === 0
    ) {
        return null;
    }
    for (const value of envelope) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return null;
        }
    }
    return { frameSec, envelope: envelope as number[] };
}
