import { inject, injectable } from 'inversify';
import { createHash } from 'node:crypto';

import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { LocalEmbeddingRuntime } from '@/backend/infrastructure/ai/LocalEmbeddingRuntime';
import type TopicVectorRepository from '@/backend/services/repositories/TopicVectorRepository';
import { decodeVector, encodeVector } from '@/common/learning/vectorCodec';
import { LOCAL_EMBEDDING_MODEL } from '@/common/contracts/local-ai';

/** 一次主题向量化结果。 */
export interface TopicEmbedding {
    /** 稳定标识。 */
    id: string;
    /** 原始向量；未归一化，交给索引层统一归一化。 */
    vector: number[];
}

/** 主题语义向量服务契约。 */
export default interface TopicEmbeddingService {
    /**
     * 批量把文本主题向量化。
     *
     * 模型未安装或推理失败时返回 `null`，调用方据此降级为词面相似度。
     *
     * @param items 标识与文本。
     * @returns 与输入顺序一致的向量；不可用时为 `null`。
     */
    embed(items: ReadonlyArray<{ id: string; text: string }>): Promise<TopicEmbedding[] | null>;

    /**
     * 删除某个视频的持久化向量。
     *
     * 视频被移除或观看记录被删除时调用，避免索引里留下永远命中不了的条目。
     *
     * @param videoIds 视频路径列表。
     * @returns 实际删除的行数。
     */
    forget(videoIds: readonly string[]): Promise<number>;

    /**
     * 剔除不在给定集合内的持久化向量。
     *
     * 观看记录被删除、视频文件被移走之后，索引里会留下永远命中不了的条目。
     * 与其在删除路径上追加一次跨服务调用，不如在每次推荐时按「当前仍存在的
     * 视频集合」自愈，删除路径漏掉也不会让索引无限增长。
     *
     * @param activeVideoIds 当前仍存在的视频路径。
     * @returns 实际删除的行数。
     */
    pruneExcept(activeVideoIds: readonly string[]): Promise<number>;
}

/** 进程内缓存上限；字幕内容变化会产生新键。 */
const MAX_CACHE_ENTRIES = 256;

/**
 * 计算主题文本的稳定哈希。
 *
 * 用内容而不是时间戳判断是否需要重新推理：字幕重切分、时间轴调整都可能
 * 让文本不变但文件变化，只有文本真的变了才值得再跑一次模型。
 *
 * @param text 主题文本。
 * @returns 十六进制 SHA-256。
 */
const topicTextHash = (text: string): string =>
    createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * 基于本地 embedding 模型的主题向量服务。
 *
 * 缓存键是文本内容哈希，同一视频重复打开首页不会重复推理；
 * 缓存只存在进程内，不落库，避免为增强能力增加迁移与清理负担。
 */
@injectable()
export class TopicEmbeddingServiceImpl implements TopicEmbeddingService {
    private readonly logger = getMainLogger('TopicEmbeddingService');
    private readonly cache = new Map<string, number[]>();

    public constructor(
        @inject(TYPES.LocalEmbeddingRuntime) private readonly runtime: LocalEmbeddingRuntime,
        @inject(TYPES.TopicVectorRepository) private readonly repository: TopicVectorRepository,
    ) {}

    public async embed(
        items: ReadonlyArray<{ id: string; text: string }>,
    ): Promise<TopicEmbedding[] | null> {
        if (items.length === 0) {
            return [];
        }
        return this.embedWithModel(LOCAL_EMBEDDING_MODEL.id, items, (texts) => this.runtime.embed(texts));
    }

    private async embedWithModel(
        model: string,
        items: ReadonlyArray<{ id: string; text: string }>,
        computeVectors: (texts: readonly string[]) => Promise<number[][] | null>,
    ): Promise<TopicEmbedding[] | null> {
        const results: TopicEmbedding[] = [];
        const missing: Array<{ id: string; text: string; index: number }> = [];
        const pendingWrites: Array<{ id: string; text: string; vector: number[] }> = [];

        // 先查进程内缓存，再查持久化索引，最后才批量推理。
        // 顺序不能反：持久化索引跨重启有效，是避免重复推理的主要来源。
        const uncached: Array<{ id: string; text: string; index: number }> = [];
        items.forEach((item, index) => {
            const cached = this.cache.get(this.cacheKey(model, item.text));
            if (cached) {
                results[index] = { id: item.id, vector: cached };
            } else {
                uncached.push({ ...item, index });
            }
        });
        if (uncached.length > 0) {
            const persisted = await this.loadPersisted(model, uncached);
            for (const item of uncached) {
                const vector = persisted.get(item.id);
                if (vector) {
                    this.remember(model, item.text, vector);
                    results[item.index] = { id: item.id, vector };
                } else {
                    missing.push(item);
                }
            }
        }
        if (missing.length > 0) {
            const vectors = await computeVectors(missing.map((item) => item.text));
            if (!vectors) {
                return null;
            }
            missing.forEach((item, offset) => {
                const vector = vectors[offset];
                if (!vector) {
                    return;
                }
                this.remember(model, item.text, vector);
                results[item.index] = { id: item.id, vector };
                pendingWrites.push({ id: item.id, text: item.text, vector });
            });
        }
        if (results.some((item) => !item)) {
            this.logger.warn('topic embedding incomplete');
            return null;
        }
        if (pendingWrites.length > 0) {
            await this.persist(model, pendingWrites);
        }
        return results;
    }

    public async forget(videoIds: readonly string[]): Promise<number> {
        if (videoIds.length === 0) {
            return 0;
        }
        const removed = await this.repository.deleteByVideoIds(videoIds);
        // 进程内缓存按文本而不是视频存储，无法精确剔除；视频数量有限，
        // 这里整体清空比留下可能失效的条目更安全。
        this.cache.clear();
        return removed;
    }

    public async pruneExcept(activeVideoIds: readonly string[]): Promise<number> {
        try {
            const rows = await this.repository.listByModel(LOCAL_EMBEDDING_MODEL.id);
            if (rows.length === 0) {
                return 0;
            }
            const active = new Set(activeVideoIds);
            const stale = Array.from(new Set(rows
                .map((row) => row.video_id)
                .filter((videoId) => !active.has(videoId))));
            if (stale.length === 0) {
                return 0;
            }
            return await this.repository.deleteByVideoIds(stale);
        } catch (error) {
            this.logger.warn('topic vector index prune skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
            return 0;
        }
    }

    /**
     * 从持久化索引读取仍有效的向量。
     *
     * 只接受维度一致、且文本哈希与当前文本相同的条目：字幕被重新切分后
     * 同一视频的主题文本会变，旧向量必须重新计算，不能按 video_id 盲目复用。
     */
    private async loadPersisted(
        model: string,
        items: ReadonlyArray<{ id: string; text: string; index: number }>,
    ): Promise<Map<string, number[]>> {
        const result = new Map<string, number[]>();
        try {
            const rows = await this.repository.listByVideoIds(model, items.map((item) => item.id));
            if (rows.length === 0) {
                return result;
            }
            const byVideo = new Map(rows.map((row) => [row.video_id, row]));
            for (const item of items) {
                const row = byVideo.get(item.id);
                if (!row || row.text_hash !== topicTextHash(item.text)) {
                    continue;
                }
                const vector = decodeVector(row.vector, row.dimension);
                if (vector) {
                    result.set(item.id, vector);
                }
            }
        } catch (error) {
            // 索引读取失败只是失去加速，不能阻断推荐；下次会重新推理并重写。
            this.logger.warn('topic vector index read skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return result;
    }

    /**
     * 把新算出的向量写回索引。
     *
     * 写入失败同样不阻断本次推荐：结果已经在内存里可用，下次最多再推理一次。
     */
    private async persist(
        model: string,
        items: ReadonlyArray<{ id: string; text: string; vector: number[] }>,
    ): Promise<void> {
        try {
            await this.repository.upsertMany(items.map((item) => ({
                videoId: item.id,
                model,
                dimension: item.vector.length,
                vector: encodeVector(item.vector),
                textHash: topicTextHash(item.text),
            })));
        } catch (error) {
            this.logger.warn('topic vector index write skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private cacheKey(model: string, text: string): string {
        return `${model}\0${text}`;
    }

    private remember(model: string, text: string, vector: number[]): void {
        this.cache.set(this.cacheKey(model, text), vector);
        while (this.cache.size > MAX_CACHE_ENTRIES) {
            const oldest = this.cache.keys().next();
            if (oldest.done) {
                break;
            }
            this.cache.delete(oldest.value);
        }
    }
}
