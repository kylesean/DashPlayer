import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { WordMatchServiceImpl } from '@/backend/services/WordMatchService';
import WordsRepositoryImpl from '@/backend/infrastructure/db/repositories/WordsRepositoryImpl';
import { words as wordsTable } from '@/backend/infrastructure/db/tables/words';
import { createMemoryDb, type MemoryDb } from '@/test/database';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';
import type { Word } from '@/backend/infrastructure/db/tables/words';

const buildWord = (word: string, status: Word['status']): Word => ({
    id: 1,
    word,
    stem: null,
    translate: null,
    note: null,
    status,
    source: 'manual',
    mastery: 0,
    confidence: 0,
    last_seen_at: null,
    mastered_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
});

describe('WordMatchService', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        vi.useRealTimers();
        memoryDb?.close();
        memoryDb = null;
    });

    it('只把 learning / familiar 词条交给字幕匹配器', async () => {
        const repository = {
            getAll: vi.fn(async () => [
                buildWord('learn', 'learning'),
                buildWord('familiar', 'familiar'),
                buildWord('known', 'known'),
                buildWord('ignored', 'ignored'),
            ]),
        } as unknown as WordsRepository;
        const service = new WordMatchServiceImpl(repository);

        const words = await service.getVocabularyWords();

        expect(words.map((word) => word.word)).toEqual(['learn', 'familiar']);
    });

    it('缓存跨过有效期后会重新读取，掌握度随新的时间衰减变化', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
        memoryDb = createMemoryDb();
        const repository = new WordsRepositoryImpl(memoryDb.db);
        await repository.insertOne({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            source: 'manual',
        });
        await memoryDb.db.update(wordsTable)
            .set({ mastery: 0.8, confidence: 0.6, last_seen_at: '2026-03-01T00:00:00.000Z' })
            .where(eq(wordsTable.word, 'journey'))
            .run();
        const getAllSpy = vi.spyOn(repository, 'getAll');
        const service = new WordMatchServiceImpl(repository);

        const first = await service.getVocabularyWords();
        expect(first[0].mastery).toBeCloseTo(0.8, 6);

        // 有效期内的第二次读取命中缓存，不重新折算。
        vi.setSystemTime(new Date('2026-03-01T00:30:00.000Z'));
        const cached = await service.getVocabularyWords();
        expect(getAllSpy).toHaveBeenCalledTimes(1);
        expect(cached[0].mastery).toBe(first[0].mastery);

        // 越过有效期后重新读取，同一原始值按新的当前时间衰减。
        vi.setSystemTime(new Date('2026-03-01T02:00:00.000Z'));
        const refreshed = await service.getVocabularyWords();
        expect(getAllSpy).toHaveBeenCalledTimes(2);
        expect(refreshed[0].mastery).toBeLessThan(first[0].mastery);
        expect(refreshed[0].mastery).toBeCloseTo(0.8 * Math.pow(0.5, 2 / 336), 6);
    });
});
