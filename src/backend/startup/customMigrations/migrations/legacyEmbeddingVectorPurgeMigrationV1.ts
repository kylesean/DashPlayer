import { eq } from 'drizzle-orm';

import { topicVector } from '@/backend/infrastructure/db/tables/topicVector';

import type { CustomMigration } from '../types';

const MIGRATION_ID = 'legacy-embedding-vector-purge-v1';

/**
 * 已下线的本地向量模型标识。
 *
 * 旧版本用 bge-small-en-v1.5（384 维）生成主题向量；切换到 EmbeddingGemma 2
 * （768 维）后，这些行永远不会再被命中——检索按 model 过滤，维度也不同。
 * 留着只是占用磁盘并让「当前索引有多大」的统计失真。
 */
export const LEGACY_EMBEDDING_MODEL_IDS = ['bge-small-en-v1.5-q8_0'] as const;

/**
 * 清理旧向量模型留下的持久化索引行。
 *
 * 只删 `dp_topic_vector` 中属于已下线模型的行：模型文件由
 * `LocalEmbeddingRuntime.cleanupLegacyModel` 在首次读取状态时删除，
 * 两条路径互不依赖，任一条没跑都不会留下半清理状态。
 *
 * 迁移是条件写且重复执行无害：旧模型行删完后再跑一次影响 0 行。
 */
export const legacyEmbeddingVectorPurgeMigrationV1: CustomMigration = {
    id: MIGRATION_ID,
    description: 'Purge persisted topic vectors produced by the removed bge-small embedding model',
    run: async (ctx) => {
        let removed = 0;
        for (const model of LEGACY_EMBEDDING_MODEL_IDS) {
            const result = await ctx.db
                .delete(topicVector)
                .where(eq(topicVector.model, model));
            removed += Number(result.changes);
        }
        ctx.logger.info('legacy embedding vectors purged', {
            models: LEGACY_EMBEDDING_MODEL_IDS,
            removed,
        });
    },
};
