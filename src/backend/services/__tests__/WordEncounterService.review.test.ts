import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createMemoryDb, type MemoryDb } from '@/test/database';
import ReviewCardRepositoryImpl from '@/backend/infrastructure/db/repositories/ReviewCardRepositoryImpl';
import WordEncounterRepositoryImpl from '@/backend/infrastructure/db/repositories/WordEncounterRepositoryImpl';
import WordsRepositoryImpl from '@/backend/infrastructure/db/repositories/WordsRepositoryImpl';
import { wordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { WordEncounterServiceImpl } from '@/backend/services/WordEncounterService';

const DAY_MS = 24 * 60 * 60 * 1000;

const buildService = (memoryDb: MemoryDb) => {
    const words = new WordsRepositoryImpl(memoryDb.db);
    const encounters = new WordEncounterRepositoryImpl(memoryDb.db);
    const cards = new ReviewCardRepositoryImpl(memoryDb.db);
    const service = new WordEncounterServiceImpl(encounters, words, cards);
    return { service, words, encounters, cards };
};

describe('WordEncounterService 复习闭环', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('收藏目标词后立即生成到期卡', async () => {
        memoryDb = createMemoryDb();
        const { service, words } = buildService(memoryDb);
        await words.insertOne({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            source: 'manual',
        });

        await service.record({ word: 'journey', action: 'save' });

        const queue = await service.getReviewQueue();
        expect(queue.dueCount).toBe(1);
        expect(queue.items).toHaveLength(1);
        expect(queue.items[0]).toMatchObject({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
        });
        expect(queue.items[0].schedule.state).toBe('new');
    });

    it('跟读高分提高掌握度，并把复习时间推后', async () => {
        memoryDb = createMemoryDb();
        const { service, words } = buildService(memoryDb);
        await words.insertOne({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            source: 'manual',
        });
        await service.record({ word: 'journey', action: 'save' });
        const before = await words.findByWord('journey');

        await service.record({
            word: 'journey',
            action: 'shadow',
            score: 96,
            fileHash: 'subtitle-1',
            sentenceIndex: 2,
            sentenceHash: 'sentence-2',
            context: 'The journey changed everything.',
        });

        const after = await words.findByWord('journey');
        expect(after?.mastery).toBeGreaterThan(before?.mastery ?? 0);
        expect(after?.last_seen_at).not.toBeNull();
        const queue = await service.getReviewQueue();
        expect(queue.dueCount).toBe(0);
        expect(queue.items).toHaveLength(0);
        expect(queue.nextDueAt).not.toBeNull();
    });

    it('标记已掌握后删除复习卡', async () => {
        memoryDb = createMemoryDb();
        const { service, words, cards } = buildService(memoryDb);
        await words.insertOne({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            source: 'manual',
        });
        await service.record({ word: 'journey', action: 'save' });

        await service.record({ word: 'journey', action: 'known' });

        expect(await cards.findByWord('journey')).toBeNull();
        const row = await words.findByWord('journey');
        expect(row?.status).toBe('known');
        expect(row?.mastery).toBe(1);
        expect((await service.getReviewQueue()).dueCount).toBe(0);
    });

    it('到期队列只包含活跃且非默认词表的卡', async () => {
        memoryDb = createMemoryDb();
        const { service, words, cards } = buildService(memoryDb);
        await words.insertOne({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            source: 'manual',
        });
        await words.insertOne({
            word: 'orbit',
            translate: '轨道',
            status: 'familiar',
            source: 'manual',
        });
        await words.insertOne({
            word: 'the',
            translate: '这个',
            status: 'learning',
            source: 'default',
        });
        await words.insertOne({
            word: 'ignore',
            translate: '忽略',
            status: 'ignored',
            source: 'manual',
        });
        const past = new Date(Date.now() - DAY_MS).toISOString();
        for (const word of ['journey', 'orbit', 'the', 'ignore']) {
            await cards.upsert({
                word,
                due_at: past,
                state: 'new',
                reps: 0,
                lapses: 0,
                stability: 0,
                difficulty: 0,
                last_review_at: null,
                last_rating: null,
            });
        }

        const all = await service.getReviewQueue();
        expect(all.dueCount).toBe(2);
        expect(all.items.map((item) => item.word).sort()).toEqual(['journey', 'orbit']);

        const limited = await service.getReviewQueue(1);
        expect(limited.items).toHaveLength(1);
        expect(limited.dueCount).toBe(2);
    });

    it('复习反馈同步更新卡、词条、事件与 7/30 天统计', async () => {
        memoryDb = createMemoryDb();
        const { service, words } = buildService(memoryDb);
        await words.insertOne({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            source: 'manual',
        });
        await service.record({ word: 'journey', action: 'save' });
        const before = await words.findByWord('journey');
        const now = Date.now();

        const result = await service.rateReview({
            word: 'journey',
            rating: 'good',
            videoId: 'video-1',
            fileHash: 'subtitle-1',
        });

        expect(result.card.schedule).toMatchObject({
            state: 'learning',
            reps: 1,
            lastRating: 'good',
        });
        expect(Date.parse(result.card.schedule.dueAt)).toBeGreaterThan(now);
        const after = await words.findByWord('journey');
        expect(after?.mastery).toBeGreaterThan(before?.mastery ?? 0);
        expect(after?.last_seen_at).not.toBeNull();

        const reviewRows = await memoryDb.db
            .select()
            .from(wordEncounter)
            .where(eq(wordEncounter.action, 'review'));
        expect(reviewRows).toHaveLength(1);
        expect(reviewRows[0].rating).toBe('good');
        expect(reviewRows[0].video_id).toBe('video-1');
        expect(reviewRows[0].file_hash).toBe('subtitle-1');

        const firstStats = await service.getReviewQueue();
        expect(firstStats.stats.last7Days).toEqual({ reviewed: 1, retention: 1 });
        expect(firstStats.stats.last30Days).toEqual({ reviewed: 1, retention: 1 });

        await service.rateReview({ word: 'journey', rating: 'again' });
        const secondStats = await service.getReviewQueue();
        expect(secondStats.stats.last7Days).toEqual({ reviewed: 2, retention: 0.5 });
        expect(secondStats.stats.last30Days).toEqual({ reviewed: 2, retention: 0.5 });
    });

    it('不在学习状态的词不能提交复习反馈', async () => {
        memoryDb = createMemoryDb();
        const { service, words } = buildService(memoryDb);
        await words.insertOne({
            word: 'journey',
            translate: '旅程',
            status: 'known',
            source: 'manual',
        });

        await expect(service.rateReview({ word: 'journey', rating: 'good' }))
            .rejects.toThrow('不在复习队列');
    });
});
