import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inject, injectable } from 'inversify';

import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import type { LocalEmbeddingRuntime } from '@/backend/infrastructure/ai/LocalEmbeddingRuntime';
import type FfmpegService from '@/backend/services/FfmpegService';
import type MediaSignalRepository from '@/backend/services/repositories/MediaSignalRepository';
import type { SceneSentence } from '@/common/learning/sceneSegmentation';

/**
 * 画面切分信号的算法版本。
 *
 * 模型、抽帧密度或阈值变化时递增：持久化信号按
 * `videoId + kind + 版本` 唯一，版本变了旧结果自然失效并重算。
 */
export const VISUAL_SCENE_VERSION = 1;

/** 信号类型标识；与 `dp_media_signal.kind` 一致。 */
export const VISUAL_SCENE_KIND = 'visual-scenes';

/**
 * 相邻帧余弦相似度低于该值视为画面切换。
 *
 * 实测同一画面（同色重复抽帧）相似度 1.0000，不同内容 0.79–0.88，
 * 阈值取 0.90 落在两者之间：既不会被轻微压缩噪声触发，也不会漏掉明显切镜。
 */
const SCENE_CHANGE_SIMILARITY = 0.90;

/** 每部视频最多抽帧数；防止三小时长片产生数百次推理。 */
const MAX_FRAMES = 60;

/** 抽帧最小间隔；比这更密的抽帧对「换场」判定没有增益。 */
const MIN_FRAME_INTERVAL_SEC = 8;

/** 单次送入向量模型的帧数上限，与文本批量一致。 */
const EMBED_BATCH_SIZE = 8;

/** 一个画面切换点。 */
export interface VisualSceneBoundary {
    /** 切换发生的时间点，单位秒。 */
    atSec: number;
    /** 切换前的画面与切换后的画面相似度。 */
    similarity: number;
}

/**
 * 画面场景切分服务契约。
 */
export default interface VisualSceneService {
    /**
     * 读取或计算某个视频的画面切分点。
     *
     * 多模态投影未安装、视频无画面或推理失败时返回 `null`，调用方降级为纯字幕切分。
     *
     * @param videoPath 视频文件绝对路径。
     * @param sentences 用于挑选抽帧时间点的字幕句；缺省时按等间隔抽帧。
     * @returns 按时间升序的切换点；不可用时为 `null`。
     */
    getBoundaries(
        videoPath: string,
        sentences?: readonly SceneSentence[],
    ): Promise<VisualSceneBoundary[] | null>;

    /**
     * 删除某个视频的画面信号缓存。
     * @param videoPath 视频文件绝对路径。
     * @returns 删除的行数。
     */
    invalidate(videoPath: string): Promise<number>;
}

/**
 * 基于本地多模态向量的画面切分服务。
 *
 * 流程：按字幕句挑时间点 → 抽帧 → 图像向量 → 相邻相似度突变即为切换点。
 * 结果按视频持久化：一次抽帧 + 推理的代价远高于字幕启发式，不能每次进
 * 播放页都重跑。
 */
@injectable()
export class VisualSceneServiceImpl implements VisualSceneService {
    private readonly logger = getMainLogger('VisualSceneService');
    private readonly inFlight = new Map<string, Promise<VisualSceneBoundary[] | null>>();
    private readonly epochs = new Map<string, number>();

    public constructor(
        @inject(TYPES.LocalEmbeddingRuntime) private readonly embedding: LocalEmbeddingRuntime,
        @inject(TYPES.FfmpegService) private readonly ffmpegService: FfmpegService,
        @inject(TYPES.MediaSignalRepository) private readonly repository: MediaSignalRepository,
    ) {}

    public async getBoundaries(
        videoPath: string,
        sentences: readonly SceneSentence[] = [],
    ): Promise<VisualSceneBoundary[] | null> {
        // 必须在任何 await 前登记单飞，避免哈希/查库期间并发进入并竞争同一临时目录。
        const existing = this.inFlight.get(videoPath);
        if (existing) {
            return existing;
        }
        const epoch = this.epochs.get(videoPath) ?? 0;
        const task = (async () => {
            const inputHash = await videoInputHash(videoPath);
            if (!inputHash) {
                return null;
            }
            try {
                const cached = await this.repository.find(videoPath, VISUAL_SCENE_KIND, VISUAL_SCENE_VERSION);
                if (cached && cached.input_hash === inputHash) {
                    const parsed = parseBoundaries(cached.payload_json);
                    if (parsed) {
                        return parsed;
                    }
                    this.logger.warn('visual scene payload invalid, recomputing', { videoPath });
                }
            } catch (error) {
                this.logger.warn('visual scene read skipped', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            return this.compute(videoPath, inputHash, sentences, epoch);
        })();
        this.inFlight.set(videoPath, task);
        try {
            return await task;
        } finally {
            if (this.inFlight.get(videoPath) === task) {
                this.inFlight.delete(videoPath);
            }
        }
    }

    public async invalidate(videoPath: string): Promise<number> {
        this.epochs.set(videoPath, (this.epochs.get(videoPath) ?? 0) + 1);
        this.inFlight.delete(videoPath);
        try {
            return await this.repository.deleteByVideo(videoPath);
        } catch (error) {
            this.logger.warn('visual scene invalidate skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
            return 0;
        }
    }

    /**
     * 执行一次抽帧 + 向量 + 差分，并持久化结果。
     *
     * 任何失败都返回 `null`：画面理解是场景提示的增强信号，缺模型或解码
     * 失败不应该让播放页报错。
     */
    private async compute(
        videoPath: string,
        inputHash: string,
        sentences: readonly SceneSentence[],
        epoch: number,
    ): Promise<VisualSceneBoundary[] | null> {
        // 未安装多模态投影时直接退出，连抽帧都不必做。
        if (!await this.embedding.isMultimodalReady()) {
            return null;
        }
        const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dashplayer-visual-'));
        try {
            const times = pickSampleTimes(sentences);
            if (times.length < 2) {
                return [];
            }
            const frames = await this.ffmpegService.extractFrames({
                inputFile: videoPath,
                times,
                outputFolder: tempDirectory,
                job: `visual-scene:${videoPath}`,
            });
            if (frames.length < 2) {
                return [];
            }

            const vectors: Array<{ time: number; vector: number[] }> = [];
            for (let offset = 0; offset < frames.length; offset += EMBED_BATCH_SIZE) {
                const batch = frames.slice(offset, offset + EMBED_BATCH_SIZE);
                const images = await Promise.all(batch.map(async (frame) => ({
                    data: await fs.promises.readFile(frame.path),
                    mimeType: 'image/jpeg',
                })));
                const embedded = await this.embedding.embedImages(images);
                if (!embedded) {
                    return null;
                }
                batch.forEach((frame, index) => {
                    const vector = embedded[index];
                    if (vector) {
                        vectors.push({ time: frame.time, vector });
                    }
                });
            }
            const boundaries = detectSceneChanges(vectors);
            if ((this.epochs.get(videoPath) ?? 0) === epoch) {
                try {
                    await this.repository.upsert({
                        videoId: videoPath,
                        kind: VISUAL_SCENE_KIND,
                        algorithmVersion: VISUAL_SCENE_VERSION,
                        inputHash,
                        payloadJson: JSON.stringify(boundaries),
                    });
                } catch (error) {
                    this.logger.warn('visual scene write skipped', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return boundaries;
        } catch (error) {
            this.logger.warn('visual scene skipped', {
                videoPath,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        } finally {
            try {
                await fs.promises.rm(tempDirectory, { recursive: true, force: true });
            } catch {
                // 清理失败不影响结果。
            }
        }
    }
}

/**
 * 从字幕句挑选抽帧时间点。
 *
 * 每句取中点而不是句首：句首常落在上一镜头的尾巴上，中点更能代表这一句
 * 说话时的画面。句数过多时按比例抽稀到上限，保证覆盖整部视频而不是只
 * 分析前几分钟。
 *
 * @param sentences 按时间升序的字幕句。
 * @returns 升序去重的抽帧时间点。
 */
export function pickSampleTimes(sentences: readonly SceneSentence[]): number[] {
    const midpoints = sentences
        .map((sentence) => (sentence.start + sentence.end) / 2)
        .filter((time) => Number.isFinite(time) && time >= 0)
        .sort((left, right) => left - right);
    if (midpoints.length === 0) {
        return [];
    }
    const stride = Math.max(1, Math.ceil(midpoints.length / MAX_FRAMES));
    const picked: number[] = [];
    for (let index = 0; index < midpoints.length; index += stride) {
        const time = midpoints[index];
        // 间隔过近的抽帧对换场判定没有增益，反而放大噪声。
        if (picked.length === 0 || time - picked[picked.length - 1] >= MIN_FRAME_INTERVAL_SEC) {
            picked.push(time);
        }
    }
    return picked;
}

/**
 * 相邻帧相似度突变即为画面切换。
 *
 * @param vectors 按时间升序的帧向量。
 * @returns 切换点列表。
 */
export function detectSceneChanges(
    vectors: ReadonlyArray<{ time: number; vector: number[] }>,
): VisualSceneBoundary[] {
    const boundaries: VisualSceneBoundary[] = [];
    for (let index = 1; index < vectors.length; index += 1) {
        const similarity = cosineSimilarity(vectors[index - 1].vector, vectors[index].vector);
        if (similarity < SCENE_CHANGE_SIMILARITY) {
            boundaries.push({
                atSec: Number(vectors[index].time.toFixed(2)),
                similarity: Number(similarity.toFixed(4)),
            });
        }
    }
    return boundaries;
}

/**
 * 余弦相似度；维度不一致或零向量返回 0。
 *
 * @param left 向量 A。
 * @param right 向量 B。
 * @returns 相似度，范围理论上为 -1..1。
 */
function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
    if (left.length !== right.length || left.length === 0) {
        return 0;
    }
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftNorm += left[index] * left[index];
        rightNorm += right[index] * right[index];
    }
    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
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
 * 校验并解析持久化的画面切换点。
 *
 * @param json 持久化的 JSON 文本。
 * @returns 合法的切换点数组；结构不合法时为 null。
 */
function parseBoundaries(json: string): VisualSceneBoundary[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) {
        return null;
    }
    const result: VisualSceneBoundary[] = [];
    for (const item of parsed) {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        const record = item as Record<string, unknown>;
        const { atSec, similarity } = record;
        if (
            typeof atSec !== 'number'
            || typeof similarity !== 'number'
            || !Number.isFinite(atSec)
            || !Number.isFinite(similarity)
        ) {
            return null;
        }
        result.push({ atSec, similarity });
    }
    return result;
}
