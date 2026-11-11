import { describe, expect, it, vi } from 'vitest';

import { WordMatchServiceImpl } from '@/backend/services/WordMatchService';
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
});
