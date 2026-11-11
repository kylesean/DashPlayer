import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ProductionPracticeRecordRepositoryImpl from '@/backend/infrastructure/db/repositories/ProductionPracticeRecordRepositoryImpl';
import { createMemoryDb, type MemoryDb } from '@/test/database';

describe('ProductionPracticeRecordRepositoryImpl', () => {
    let memoryDb: MemoryDb;
    let repository: ProductionPracticeRecordRepositoryImpl;

    beforeEach(() => {
        memoryDb = createMemoryDb();
        repository = new ProductionPracticeRecordRepositoryImpl(memoryDb.db);
    });

    afterEach(() => {
        memoryDb.close();
    });

    it('按视频或字幕 hash 读取最近的练习记录，并保持时间倒序', async () => {
        await repository.insertOne({
            mode: 'retell',
            video_id: 'video-1',
            file_hash: 'subtitle-1',
            sentence_text: 'It was a long journey home.',
            response_text: 'The trip home was long.',
            level: 'great',
        });
        await repository.insertOne({
            mode: 'roleplay',
            video_id: 'video-1',
            file_hash: 'subtitle-1',
            sentence_text: 'It was a long journey home.',
            response_text: 'It was long, but I was glad to be back.',
            level: 'good',
        });
        await repository.insertOne({
            mode: 'retell',
            video_id: 'video-2',
            file_hash: 'subtitle-2',
            sentence_text: 'Another day.',
            response_text: 'One more day.',
            level: 'retry',
        });

        const byVideo = await repository.listRecentByLocation({ videoId: 'video-1' });
        expect(byVideo.map((record) => record.mode)).toEqual(['roleplay', 'retell']);

        const byHash = await repository.listRecentByLocation({ fileHash: 'subtitle-1', limit: 1 });
        expect(byHash).toHaveLength(1);
        expect(byHash[0].mode).toBe('roleplay');

        expect(await repository.listRecentByLocation({})).toEqual([]);
    });
});
