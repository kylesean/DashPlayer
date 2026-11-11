import { afterEach, describe, expect, it } from 'vitest';

import TopicVectorRepositoryImpl from '@/backend/infrastructure/db/repositories/TopicVectorRepositoryImpl';
import { decodeVector, encodeVector } from '@/common/learning/vectorCodec';
import { createMemoryDb, type MemoryDb } from '@/test/database';

const MODEL = 'embeddinggemma-2-q4_k_xl';

describe('TopicVectorRepositoryImpl', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('BLOB 往返后向量逐位相等', async () => {
        memoryDb = createMemoryDb();
        const repository = new TopicVectorRepositoryImpl(memoryDb.db);
        const vector = [0.125, -0.5, 0.75, 1];

        await repository.upsert({
            videoId: 'video-a',
            model: MODEL,
            dimension: vector.length,
            vector: encodeVector(vector),
            textHash: 'hash-a',
        });

        const [row] = await repository.listByModel(MODEL);
        expect(row.dimension).toBe(4);
        expect(decodeVector(row.vector, row.dimension)).toEqual(vector);
    });

    it('同一视频 + 模型重复写入时更新而不是新增', async () => {
        memoryDb = createMemoryDb();
        const repository = new TopicVectorRepositoryImpl(memoryDb.db);
        await repository.upsert({
            videoId: 'video-a',
            model: MODEL,
            dimension: 2,
            vector: encodeVector([1, 0]),
            textHash: 'old',
        });
        await repository.upsert({
            videoId: 'video-a',
            model: MODEL,
            dimension: 2,
            vector: encodeVector([0, 1]),
            textHash: 'new',
        });

        const rows = await repository.listByModel(MODEL);
        expect(rows).toHaveLength(1);
        expect(rows[0].text_hash).toBe('new');
        expect(decodeVector(rows[0].vector, rows[0].dimension)).toEqual([0, 1]);
    });

    it('不同模型互不覆盖，检索按模型隔离', async () => {
        memoryDb = createMemoryDb();
        const repository = new TopicVectorRepositoryImpl(memoryDb.db);
        await repository.upsertMany([
            { videoId: 'video-a', model: MODEL, dimension: 2, vector: encodeVector([1, 0]), textHash: 'h' },
            { videoId: 'video-a', model: 'embeddinggemma-2-mmproj', dimension: 2, vector: encodeVector([0, 1]), textHash: 'h' },
        ]);

        const primary = await repository.listByModel(MODEL);
        const other = await repository.listByModel('embeddinggemma-2-mmproj');

        expect(primary).toHaveLength(1);
        expect(other).toHaveLength(1);
        expect(decodeVector(primary[0].vector, 2)).toEqual([1, 0]);
        expect(decodeVector(other[0].vector, 2)).toEqual([0, 1]);
    });

    it('按视频批量读取只返回命中项', async () => {
        memoryDb = createMemoryDb();
        const repository = new TopicVectorRepositoryImpl(memoryDb.db);
        await repository.upsertMany([
            { videoId: 'a', model: MODEL, dimension: 2, vector: encodeVector([1, 0]), textHash: 'h' },
            { videoId: 'b', model: MODEL, dimension: 2, vector: encodeVector([0, 1]), textHash: 'h' },
        ]);

        const rows = await repository.listByVideoIds(MODEL, ['a', 'missing']);

        expect(rows.map((row) => row.video_id)).toEqual(['a']);
        expect(await repository.listByVideoIds(MODEL, [])).toEqual([]);
    });

    it('deleteByModel 与 deleteByVideoIds 只删除目标范围', async () => {
        memoryDb = createMemoryDb();
        const repository = new TopicVectorRepositoryImpl(memoryDb.db);
        await repository.upsertMany([
            { videoId: 'a', model: MODEL, dimension: 2, vector: encodeVector([1, 0]), textHash: 'h' },
            { videoId: 'b', model: MODEL, dimension: 2, vector: encodeVector([0, 1]), textHash: 'h' },
            { videoId: 'a', model: 'other', dimension: 2, vector: encodeVector([1, 1]), textHash: 'h' },
        ]);

        expect(await repository.deleteByVideoIds(['a'])).toBe(2);
        expect(await repository.listByModel(MODEL)).toHaveLength(1);

        expect(await repository.deleteByModel(MODEL)).toBe(1);
        expect(await repository.listByModel(MODEL)).toHaveLength(0);
    });
});
