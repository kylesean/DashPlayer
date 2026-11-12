import { describe, expect, it, vi } from 'vitest';

import {
    SubtitleComprehensionServiceImpl,
} from '@/backend/services/SubtitleComprehensionService';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import { builtinDictionaryMetaStub } from '@/test/builtinDictionaryFixture';

const dictionaryEntry = (
    word: string,
    overrides: Partial<OpenAIDictionaryResult> = {},
): OpenAIDictionaryResult => ({
    word,
    phonetic: `/${word}/`,
    definitions: [{ partOfSpeech: 'n.', meaning: '释义', examples: [] }],
    ...overrides,
});

const createHarness = ({
    entries = {},
    userWords = [],
}: {
    entries?: Record<string, OpenAIDictionaryResult>;
    userWords?: Word[];
}) => {
    const dictionaryStore: BuiltinDictionaryStore = {
        lookup: vi.fn((word: string) => entries[word.toLowerCase()] ?? null),
        meta: () => builtinDictionaryMetaStub(Object.keys(entries).length),
    };
    const wordsRepository = {
        getAll: vi.fn().mockResolvedValue(userWords),
    } as unknown as WordsRepository;
    return new SubtitleComprehensionServiceImpl(wordsRepository, dictionaryStore);
};

const userWord = (word: string, status: Word['status'], mastery: number): Word => ({
    id: 1,
    word,
    stem: null,
    translate: '释义',
    note: null,
    status,
    source: 'manual',
    mastery,
    confidence: 0.8,
    last_seen_at: null,
    mastered_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
});

describe('SubtitleComprehensionService', () => {
    it('基础词组成的短句得到高理解度', async () => {
        const service = createHarness({
            entries: {
                journey: dictionaryEntry('journey', { oxford: 1, bnc: 1200 }),
                friend: dictionaryEntry('friend', { collins: 5 }),
                home: dictionaryEntry('home', { bnc: 800 }),
                came: dictionaryEntry('come', { bnc: 500 }),
            },
        });

        const result = await service.build({
            text: 'My friend came home after the journey.',
        });

        expect(result.band).toBe('high');
        expect(result.unknownWords).toEqual([]);
    });

    it('大量高级词与多从句得到低理解度', async () => {
        const service = createHarness({
            entries: {
                serendipity: dictionaryEntry('serendipity', { tags: ['gre'] }),
                ubiquitous: dictionaryEntry('ubiquitous', { tags: ['toefl'] }),
                notwithstanding: dictionaryEntry('notwithstanding', { tags: ['ielts'] }),
                meticulous: dictionaryEntry('meticulous', { tags: ['gre'] }),
            },
        });

        const result = await service.build({
            text: 'Although the serendipity was ubiquitous, notwithstanding the meticulous plan, which felt unusual, the outcome remained unclear.',
        });

        expect(result.band).toBe('low');
        expect(result.unknownWords).toEqual(expect.arrayContaining(['serendipity', 'ubiquitous']));
    });

    it('用户标记已掌握会抬升含高级词的句子理解度', async () => {
        const service = createHarness({
            entries: {
                serendipity: dictionaryEntry('serendipity', { tags: ['gre'] }),
                shaped: dictionaryEntry('shape', { bnc: 1500 }),
                outcome: dictionaryEntry('outcome', { bnc: 1800 }),
            },
            userWords: [userWord('serendipity', 'known', 1)],
        });

        const result = await service.build({
            text: 'Serendipity shaped the outcome.',
        });

        expect(result.band).toBe('high');
        expect(result.unknownWords).toEqual([]);
    });

    it('空句显式报错，避免把缺数据处理成高理解度', async () => {
        const service = createHarness({});

        await expect(service.build({ text: '   ' })).rejects.toThrow('句子不能为空');
    });
});
