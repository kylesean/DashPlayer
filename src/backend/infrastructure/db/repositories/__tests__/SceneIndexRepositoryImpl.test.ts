import { afterEach, describe, expect, it } from 'vitest';

import SceneIndexRepositoryImpl from '@/backend/infrastructure/db/repositories/SceneIndexRepositoryImpl';
import { createMemoryDb, type MemoryDb } from '@/test/database';

describe('SceneIndexRepositoryImpl', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('按字幕哈希与版本读取，未命中返回 null', async () => {
        memoryDb = createMemoryDb();
        const repository = new SceneIndexRepositoryImpl(memoryDb.db);

        expect(await repository.find('missing', 1)).toBeNull();

        await repository.upsert({
            fileHash: 'hash-a',
            algorithmVersion: 1,
            inputHash: 'input-1',
            boundariesJson: '[]',
        });

        const found = await repository.find('hash-a', 1);
        expect(found).toMatchObject({
            file_hash: 'hash-a',
            algorithm_version: 1,
            input_hash: 'input-1',
            boundaries_json: '[]',
        });
        expect(await repository.find('hash-a', 2)).toBeNull();
    });

    it('同一文件同一版本重复写入时更新而不是新增', async () => {
        memoryDb = createMemoryDb();
        const repository = new SceneIndexRepositoryImpl(memoryDb.db);
        await repository.upsert({
            fileHash: 'hash-a',
            algorithmVersion: 1,
            inputHash: 'input-1',
            boundariesJson: '[]',
        });
        await repository.upsert({
            fileHash: 'hash-a',
            algorithmVersion: 1,
            inputHash: 'input-2',
            boundariesJson: '[{"sentenceIndex":1}]',
        });

        const found = await repository.find('hash-a', 1);
        expect(found?.input_hash).toBe('input-2');
        expect(found?.boundaries_json).toBe('[{"sentenceIndex":1}]');
    });

    it('不同算法版本各自保留，deleteByFile 全部清除', async () => {
        memoryDb = createMemoryDb();
        const repository = new SceneIndexRepositoryImpl(memoryDb.db);
        await repository.upsert({ fileHash: 'hash-a', algorithmVersion: 1, inputHash: 'i', boundariesJson: '[]' });
        await repository.upsert({ fileHash: 'hash-a', algorithmVersion: 2, inputHash: 'i', boundariesJson: '[]' });
        await repository.upsert({ fileHash: 'hash-b', algorithmVersion: 1, inputHash: 'i', boundariesJson: '[]' });

        expect(await repository.deleteByFile('hash-a')).toBe(2);
        expect(await repository.find('hash-a', 1)).toBeNull();
        expect(await repository.find('hash-a', 2)).toBeNull();
        expect(await repository.find('hash-b', 1)).not.toBeNull();
    });
});
