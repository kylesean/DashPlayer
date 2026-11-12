import { afterEach, describe, expect, it } from 'vitest';

import ContextPackService, { ContextPackServiceImpl } from '@/backend/services/ContextPackService';
import ReviewCardRepositoryImpl from '@/backend/infrastructure/db/repositories/ReviewCardRepositoryImpl';
import WordEncounterRepositoryImpl from '@/backend/infrastructure/db/repositories/WordEncounterRepositoryImpl';
import WordsRepositoryImpl from '@/backend/infrastructure/db/repositories/WordsRepositoryImpl';
import { SentenceVocabularyServiceImpl } from '@/backend/services/SentenceVocabularyService';
import { WordMatchServiceImpl } from '@/backend/services/WordMatchService';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import { createMemoryDb, type MemoryDb } from '@/test/database';
import { builtinDictionaryMetaStub } from '@/test/builtinDictionaryFixture';

const HOUR_MS = 60 * 60 * 1000;

const dictionaryEntry = (
    word: string,
    meaning: string,
    tags: string[],
): OpenAIDictionaryResult => ({
    word,
    phonetic: `/${word}/`,
    definitions: [{
        partOfSpeech: 'n.',
        meaning,
        examples: [],
    }],
    tags,
});

/**
 * 构造只读词典替身；这里只 mock 外部词典网关，仓储全部使用真实内存 SQLite。
 */
const buildDictionary = (): BuiltinDictionaryStore => {
    const entries = new Map<string, OpenAIDictionaryResult>([
        ['journey', dictionaryEntry('journey', '旅程', ['cet4'])],
        ['serendipity', dictionaryEntry('serendipity', '意外发现美好事物的能力', ['cet6'])],
    ]);
    return {
        lookup: (word: string) => entries.get(word.trim().toLowerCase()) ?? null,
        meta: () => builtinDictionaryMetaStub(entries.size),
    };
};

interface TestHarness {
    service: ContextPackService;
    words: WordsRepositoryImpl;
    cards: ReviewCardRepositoryImpl;
    encounters: WordEncounterRepositoryImpl;
}

const buildHarness = (memoryDb: MemoryDb): TestHarness => {
    const words = new WordsRepositoryImpl(memoryDb.db);
    const cards = new ReviewCardRepositoryImpl(memoryDb.db);
    const encounters = new WordEncounterRepositoryImpl(memoryDb.db);
    const wordMatch = new WordMatchServiceImpl(words);
    const sentenceVocabulary = new SentenceVocabularyServiceImpl(buildDictionary(), wordMatch);
    const service = new ContextPackServiceImpl(
        sentenceVocabulary,
        wordMatch,
        cards,
        encounters,
    );
    return { service, words, cards, encounters };
};

const seedJourney = async (harness: TestHarness): Promise<void> => {
    await harness.words.insertOne({
        word: 'journey',
        translate: '旅程',
        status: 'learning',
        source: 'manual',
    });
    await harness.words.updateLearning('journey', {
        mastery: 0.2,
        confidence: 0.4,
        status: 'learning',
        lastSeenAt: new Date().toISOString(),
    });
};

describe('ContextPackService', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('到期用户词获得本句唯一建议，并返回 token 与密度约束', async () => {
        memoryDb = createMemoryDb();
        const harness = buildHarness(memoryDb);
        await seedJourney(harness);
        await harness.cards.upsert({
            word: 'journey',
            due_at: new Date(Date.now() - HOUR_MS).toISOString(),
            state: 'new',
            reps: 0,
            lapses: 0,
            stability: 0,
            difficulty: 0,
            last_review_at: null,
            last_rating: null,
        });

        const pack = await harness.service.build({
            text: 'The journey rewards serendipity.',
            fileHash: 'subtitle-1',
            sentenceIndex: 2,
            guidance: 'coach',
        });

        expect(pack.suggestion?.word).toBe('journey');
        expect(pack.suggestion?.reasons).toContain('due_now');
        expect(pack.density).toEqual({ active: 1, max: 1 });
        expect(pack.fileHash).toBe('subtitle-1');
        expect(pack.sentenceIndex).toBe(2);
        expect(pack.vocabularyRevision).toBe(0);
        expect(pack.tokens.some((token) => token.lemma === 'journey' && token.isContentWord)).toBe(true);
        expect(pack.contentWords).toBeGreaterThan(0);
    });

    it('安静模式保留候选但不主动推荐', async () => {
        memoryDb = createMemoryDb();
        const harness = buildHarness(memoryDb);
        await seedJourney(harness);

        const pack = await harness.service.build({
            text: 'The journey rewards serendipity.',
            guidance: 'calm',
        });

        expect(pack.suggestion).toBeNull();
        expect(pack.density.active).toBe(0);
        expect(pack.candidates.length).toBeGreaterThan(0);
    });

    it('最近忽略过的新词会在抑制窗口内跳过', async () => {
        memoryDb = createMemoryDb();
        const harness = buildHarness(memoryDb);
        await seedJourney(harness);
        await harness.encounters.record({
            word: 'serendipity',
            lemma: 'serendipity',
            action: 'ignore',
            video_id: 'video-1',
            file_hash: 'subtitle-1',
            sentence_index: 2,
            sentence_hash: 'subtitle-1:2',
            context: 'The journey rewards serendipity.',
            score: null,
            rating: null,
            created_at: new Date().toISOString(),
        });

        const pack = await harness.service.build({
            text: 'The journey rewards serendipity.',
            fileHash: 'subtitle-1',
            sentenceIndex: 2,
            guidance: 'coach',
        });

        expect(pack.candidates.map((candidate) => candidate.word)).not.toContain('serendipity');
    });

    it('刚展示过建议时进入冷却，避免每句都打断阅读', async () => {
        memoryDb = createMemoryDb();
        const harness = buildHarness(memoryDb);
        await seedJourney(harness);
        await harness.encounters.record({
            word: 'serendipity',
            lemma: 'serendipity',
            action: 'seen',
            video_id: 'video-1',
            file_hash: 'subtitle-1',
            sentence_index: 1,
            sentence_hash: 'subtitle-1:1',
            context: 'A previous sentence.',
            score: null,
            rating: null,
            created_at: new Date().toISOString(),
        });

        const pack = await harness.service.build({
            text: 'The journey rewards serendipity.',
            fileHash: 'subtitle-1',
            sentenceIndex: 2,
            guidance: 'coach',
        });

        expect(pack.suggestion).toBeNull();
        expect(pack.density.active).toBe(0);
    });

    it('空句子直接报错，避免生成无意义建议', async () => {
        memoryDb = createMemoryDb();
        const harness = buildHarness(memoryDb);

        await expect(harness.service.build({ text: '   ', guidance: 'coach' }))
            .rejects.toThrow('句子不能为空');
    });
});
