import { describe, expect, it } from 'vitest';
import { SentenceVocabularyServiceImpl } from '@/backend/services/SentenceVocabularyService';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import type { WordMatchService } from '@/backend/services/WordMatchService';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import { builtinDictionaryMetaStub } from '@/test/builtinDictionaryFixture';

const dictEntry = (
    word: string,
    meaning: string,
    opts: Partial<OpenAIDictionaryResult> = {},
): OpenAIDictionaryResult => ({
    word,
    phonetic: `/${word}/`,
    definitions: [{ partOfSpeech: 'n.', meaning, examples: [] }],
    tags: [],
    ...opts,
});

describe('SentenceVocabularyService (个人记忆加权与去水词)', () => {
    it('简单日常句不再强行凑 3 张常见词卡片（MIN_CARDS=3 已移除），悬停 details 仍完整保留', async () => {
        const dict: BuiltinDictionaryStore = {
            lookup: (w) => ({
                good: dictEntry('good', '好的', { oxford: 1, bnc: 100, tags: ['zk'] }),
                morning: dictEntry('morning', '早晨', { oxford: 1, bnc: 250, tags: ['zk'] }),
            }[w] ?? null),
            meta: () => builtinDictionaryMetaStub(0),
        };
        const wordMatch = { getVocabularyWords: async () => [] } as unknown as WordMatchService;
        const service = new SentenceVocabularyServiceImpl(dict, wordMatch);

        const res = await service.pick('Good morning.');
        expect(res.picks).toHaveLength(0);
        expect(res.details.good).toBeDefined();
        expect(res.details.morning).toBeDefined();
    });

    it('过滤连词、介词、代词与缺乏高阶频次依据的普通词汇，只保留真正高价值内容词', async () => {
        const dict: BuiltinDictionaryStore = {
            lookup: (w) => ({
                however: dictEntry('however', '然而', {}),
                because: dictEntry('because', '因为', {}),
                although: dictEntry('although', '虽然', {}),
                something: dictEntry('something', '某事', {}),
                without: dictEntry('without', '没有', {}),
                serendipity: dictEntry('serendipity', '意外发现珍奇事物的运气', { bnc: 18000, tags: ['gre'] }),
            }[w] ?? null),
            meta: () => builtinDictionaryMetaStub(0),
        };
        const wordMatch = { getVocabularyWords: async () => [] } as unknown as WordMatchService;
        const service = new SentenceVocabularyServiceImpl(dict, wordMatch);

        const res = await service.pick('However, something felt like serendipity because although without.');
        expect(res.picks.map((p) => p.word)).toEqual(['serendipity']);
        expect(res.details.however).toBeDefined();
        expect(res.details.something).toBeDefined();
    });

    it('即使频繁悬停点过 think / yourself 等虚词或基础高频词，也不会被提升为本句焦点词', async () => {
        const dict: BuiltinDictionaryStore = {
            lookup: (w) => ({
                think: dictEntry('think', '想；认为', {}),
                yourself: dictEntry('yourself', '你自己', {}),
                routine: dictEntry('routine', '日常；常规', { collins: 2, bnc: 5200, tags: ['cet4'] }),
            }[w] ?? null),
            meta: () => builtinDictionaryMetaStub(0),
        };
        const vocabWords: Word[] = [{
            id: 3,
            word: 'routine',
            translate: '例行公事',
            status: 'learning',
            source: 'manual',
            mastery: 0.2,
            confidence: 0.3,
            last_seen_at: null,
            created_at: '',
            updated_at: '',
        } as Word];
        const wordMatch = { getVocabularyWords: async () => vocabWords } as unknown as WordMatchService;
        const encounterRepo = {
            listActionsSince: async () => [
                { lemma: 'think', action: 'lookup', createdAt: new Date().toISOString() },
                { lemma: 'think', action: 'lookup', createdAt: new Date().toISOString() },
                { lemma: 'yourself', action: 'open', createdAt: new Date().toISOString() },
                { lemma: 'yourself', action: 'lookup', createdAt: new Date().toISOString() },
            ],
        } as unknown as WordEncounterRepository;

        const service = new SentenceVocabularyServiceImpl(dict, wordMatch, undefined, encounterRepo);
        const res = await service.pick('I think you should ask yourself, is your routine too routine?');
        expect(res.picks.map((p) => p.word)).toEqual(['routine']);
        expect(res.details.think).toBeDefined();
        expect(res.details.yourself).toBeDefined();
    });

    it('已掌握词（known 或 mastery>=0.8）退出焦点卡并进入 masteredWords；到期与高频查词自动前置标注', async () => {
        const dict: BuiltinDictionaryStore = {
            lookup: (w) => ({
                apple: dictEntry('apple', '苹果', { oxford: 1, bnc: 800, tags: ['zk'] }),
                leverage: dictEntry('leverage', '杠杆；利用', { collins: 2, bnc: 4500, tags: ['cet6'] }),
                nudge: dictEntry('nudge', '轻推；微促', { collins: 1, bnc: 12000, tags: ['gre'] }),
            }[w] ?? null),
            meta: () => builtinDictionaryMetaStub(0),
        };
        const vocabWords: Word[] = [
            {
                id: 1,
                word: 'apple',
                translate: '苹果',
                status: 'known',
                source: 'manual',
                mastery: 0.95,
                confidence: 1,
                last_seen_at: null,
                created_at: '',
                updated_at: '',
            } as Word,
            {
                id: 2,
                word: 'leverage',
                translate: '撬动',
                status: 'learning',
                source: 'manual',
                mastery: 0.3,
                confidence: 0.5,
                last_seen_at: null,
                created_at: '',
                updated_at: '',
            } as Word,
        ];
        const wordMatch = { getVocabularyWords: async () => vocabWords } as unknown as WordMatchService;
        const reviewRepo = {
            findByWord: async (word: string) => (word === 'leverage'
                ? { due_at: new Date(Date.now() - 3600_000).toISOString() }
                : null),
        } as unknown as ReviewCardRepository;
        const encounterRepo = {
            listActionsSince: async () => [
                { lemma: 'nudge', action: 'lookup', createdAt: new Date().toISOString() },
                { lemma: 'nudge', action: 'open', createdAt: new Date().toISOString() },
            ],
        } as unknown as WordEncounterRepository;

        const service = new SentenceVocabularyServiceImpl(dict, wordMatch, reviewRepo, encounterRepo);
        const res = await service.pick('I leverage apple to nudge progress.');

        expect(res.picks.map((p) => p.word)).toEqual(['leverage', 'nudge']);
        expect(res.picks[0]?.memoryTag).toBe('due');
        expect(res.picks[1]?.memoryTag).toBe('lookup');
        expect(res.memoryHints?.focusWords).toEqual(['leverage', 'nudge']);
        expect(res.memoryHints?.masteredWords).toContain('apple');
        expect(res.details.apple).toBeDefined();
    });
});
