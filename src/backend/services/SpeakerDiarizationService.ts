import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inject, injectable } from 'inversify';

import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import type FfmpegService from '@/backend/services/FfmpegService';
import type MediaSignalRepository from '@/backend/services/repositories/MediaSignalRepository';
import type SpeakerDiarizationGateway from '@/backend/services/gateways/media/SpeakerDiarizationGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type { SpeakerInterval } from '@/common/learning/sceneSegmentation';

/**
 * 声纹分段信号的算法版本。
 *
 * 模型、聚类参数或输出结构变化时递增：持久化信号按
 * `videoId + kind + 版本` 唯一，版本变了旧结果自然失效并重算。
 */
export const SPEAKER_SEGMENTATION_VERSION = 1;

/** 信号类型标识；与 `dp_media_signal.kind` 一致。 */
export const SPEAKER_SEGMENTATION_KIND = 'speaker-segments';

/**
 * 说话人分离服务契约。
 */
export default interface SpeakerDiarizationService {
    /**
     * 读取或计算某个视频的声纹分段。
     *
     * 模型未安装、视频无音轨或分离失败时返回 `null`，调用方降级为文本启发式。
     *
     * @param videoPath 视频文件绝对路径。
     * @param isCancelled 可选的取消判定。
     * @returns 声纹区间；不可用时为 `null`。
     */
    getIntervals(
        videoPath: string,
        isCancelled?: () => boolean,
    ): Promise<SpeakerInterval[] | null>;

    /**
     * 删除某个视频的声纹缓存。
     * @param videoPath 视频文件绝对路径。
     * @returns 删除的行数。
     */
    invalidate(videoPath: string): Promise<number>;
}

/**
 * 基于 sherpa-onnx 的本地声纹分段服务。
 *
 * 流程：抽取 16kHz 单声道 WAV → 运行分离 CLI → 按视频持久化。
 * 分离是整段视频级的重计算，因此结果必须跨会话复用；视频文件被替换
 * （大小或修改时间变化）时输入指纹变化，自动重算。
 */
@injectable()
export class SpeakerDiarizationServiceImpl implements SpeakerDiarizationService {
    private readonly logger = getMainLogger('SpeakerDiarizationService');

    /** 进行中的计算，避免同一视频并发重复分离。 */
    private readonly inFlight = new Map<string, Promise<SpeakerInterval[] | null>>();

    public constructor(
        @inject(TYPES.SpeakerDiarizationGateway)
        private readonly gateway: SpeakerDiarizationGateway,
        @inject(TYPES.FfmpegService) private readonly ffmpegService: FfmpegService,
        @inject(TYPES.MediaSignalRepository) private readonly repository: MediaSignalRepository,
        @inject(TYPES.StorageDirectoryProvider)
        private readonly directories: StorageDirectoryProvider,
    ) {}

    public async getIntervals(
        videoPath: string,
        isCancelled?: () => boolean,
    ): Promise<SpeakerInterval[] | null> {
        const inputHash = await videoInputHash(videoPath);
        if (!inputHash) {
            return null;
        }
        try {
            const cached = await this.repository.find(videoPath, SPEAKER_SEGMENTATION_KIND, SPEAKER_SEGMENTATION_VERSION);
            if (cached && cached.input_hash === inputHash) {
                const parsed = parseIntervals(cached.payload_json);
                if (parsed) {
                    return parsed;
                }
                this.logger.warn('speaker signal payload invalid, recomputing', { videoPath });
            }
        } catch (error) {
            this.logger.warn('speaker signal read skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        const existing = this.inFlight.get(videoPath);
        if (existing) {
            return existing;
        }
        const task = this.compute(videoPath, inputHash, isCancelled);
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
            this.logger.warn('speaker signal invalidate skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
            return 0;
        }
    }

    /**
     * 执行一次完整分离并持久化。
     *
     * 任何失败都返回 `null` 而不是抛错：声纹是场景提示的增强信号，
     * 缺模型或解码失败不应该让播放页报错。
     */
    private async compute(
        videoPath: string,
        inputHash: string,
        isCancelled?: () => boolean,
    ): Promise<SpeakerInterval[] | null> {
        const tempDirectory = await this.directories.provideDirectory(StorageDirectoryTarget.TEMP);
        const wavPath = path.join(tempDirectory, `diarization-${createHash('sha1').update(videoPath).digest('hex')}.wav`);
        try {
            await this.ffmpegService.convertToWav(videoPath, wavPath);
            const result = await this.gateway.diarize({
                audioPath: wavPath,
                modelsRoot: await this.directories.provideDirectory(StorageDirectoryTarget.MODELS),
                job: `diarization:${videoPath}`,
                isCancelled,
            });
            const intervals: SpeakerInterval[] = result.segments.map((segment) => ({
                start: segment.start,
                end: segment.end,
                speaker: segment.speaker,
            }));
            try {
                await this.repository.upsert({
                    videoId: videoPath,
                    kind: SPEAKER_SEGMENTATION_KIND,
                    algorithmVersion: SPEAKER_SEGMENTATION_VERSION,
                    inputHash,
                    payloadJson: JSON.stringify(intervals),
                });
            } catch (error) {
                // 写入失败只影响下次是否重算，不影响本次结果。
                this.logger.warn('speaker signal write skipped', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            return intervals;
        } catch (error) {
            this.logger.warn('speaker diarization skipped', {
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
 * 计算视频文件的输入指纹：路径 + 大小 + 修改时间。
 *
 * 不解码内容：整段视频哈希的代价与分离本身相当，而大小与修改时间足以
 * 覆盖「换了一部同名视频」这种真实场景。
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
 * 校验并解析持久化的声纹区间。
 *
 * @param json 持久化的 JSON 文本。
 * @returns 合法的区间数组；结构不合法时为 null。
 */
function parseIntervals(json: string): SpeakerInterval[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) {
        return null;
    }
    const result: SpeakerInterval[] = [];
    for (const item of parsed) {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        const record = item as Record<string, unknown>;
        const { start, end, speaker } = record;
        if (
            typeof start !== 'number'
            || typeof end !== 'number'
            || typeof speaker !== 'string'
            || !Number.isFinite(start)
            || !Number.isFinite(end)
            || end <= start
        ) {
            return null;
        }
        result.push({ start, end, speaker });
    }
    return result;
}
