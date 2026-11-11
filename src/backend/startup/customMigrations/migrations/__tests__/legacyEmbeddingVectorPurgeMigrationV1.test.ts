import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createMemoryDb, type MemoryDb } from '@/test/database';
import { topicVector } from '@/backend/infrastructure/db/tables/topicVector';
import type { MainLogger } from '@/backend/infrastructure/logger';
import type { CustomMigrationContext } from '../../types';
import {
    LEGACY_EMBEDDING_MODEL_IDS,
    legacyEmbeddingVectorPurgeMigrationV1,
} from '../legacyEmbeddingVectorPurgeMigrationV1';

const stubLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
} as unknown as MainLogger;

const settings = (): CustomMigrationContext['settings'] => ({
    getPersisted: () => null,
    hasPersisted: () => false,
    set: () => true,
    delete: () => undefined,
});

/** 写入一条主题向量；向量内容不参与迁移判定，用 4 字节占位即可。 */
const insertVector = async (memoryDb: MemoryDb, videoId: string, model: string): Promise<void> => {
    await memoryDb.db.insert(topicVector).values({
        video_id: videoId,
        model,
        dimension: 1,
        vector: Buffer.from([0, 0, 0, 0]),
        text_hash: 'hash',
    });
};

describe('legacyEmbeddingVectorPurgeMigrationV1', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('只删除旧模型的向量，当前模型的索引原样保留', async () => {
        memoryDb = createMemoryDb();
        const legacy = LEGACY_EMBEDDING_MODEL_IDS[0];
        await insertVector(memoryDb, '/video/a.mp4', legacy);
        await insertVector(memoryDb, '/video/b.mp4', legacy);
        await insertVector(memoryDb, '/video/a.mp4', 'embeddinggemma-2-q4_k_xl');

        await legacyEmbeddingVectorPurgeMigrationV1.run({
            settings: settings(),
            db: memoryDb.db,
            logger: stubLogger,
        });

        const remaining = await memoryDb.db.select().from(topicVector);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].model).toBe('embeddinggemma-2-q4_k_xl');
        expect(await memoryDb.db.select().from(topicVector).where(eq(topicVector.model, legacy))).toHaveLength(0);
    });

    it('重复执行无害：旧模型行已清空时影响 0 行', async () => {
        memoryDb = createMemoryDb();
        await insertVector(memoryDb, '/video/a.mp4', 'embeddinggemma-2-q4_k_xl');

        await legacyEmbeddingVectorPurgeMigrationV1.run({
            settings: settings(),
            db: memoryDb.db,
            logger: stubLogger,
        });
        await legacyEmbeddingVectorPurgeMigrationV1.run({
            settings: settings(),
            db: memoryDb.db,
            logger: stubLogger,
        });

        expect(await memoryDb.db.select().from(topicVector)).toHaveLength(1);
    });
});
