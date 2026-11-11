import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { LocalEmbeddingRuntime } from '@/backend/infrastructure/ai/LocalEmbeddingRuntime';

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
}

/** 进程内缓存上限；字幕内容变化会产生新键。 */
const MAX_CACHE_ENTRIES = 256;

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
    ) {}

    public async embed(
        items: ReadonlyArray<{ id: string; text: string }>,
    ): Promise<TopicEmbedding[] | null> {
        if (items.length === 0) {
            return [];
        }
        const results: TopicEmbedding[] = [];
        const missing: Array<{ id: string; text: string; index: number }> = [];
        items.forEach((item, index) => {
            const cached = this.cache.get(item.text);
            if (cached) {
                results[index] = { id: item.id, vector: cached };
            } else {
                missing.push({ ...item, index });
            }
        });
        if (missing.length > 0) {
            const vectors = await this.runtime.embed(missing.map((item) => item.text));
            if (!vectors) {
                return null;
            }
            missing.forEach((item, offset) => {
                const vector = vectors[offset];
                if (!vector) {
                    return;
                }
                this.remember(item.text, vector);
                results[item.index] = { id: item.id, vector };
            });
        }
        if (results.some((item) => !item)) {
            this.logger.warn('topic embedding incomplete');
            return null;
        }
        return results;
    }

    private remember(text: string, vector: number[]): void {
        this.cache.set(text, vector);
        while (this.cache.size > MAX_CACHE_ENTRIES) {
            const oldest = this.cache.keys().next();
            if (oldest.done) {
                break;
            }
            this.cache.delete(oldest.value);
        }
    }
}
