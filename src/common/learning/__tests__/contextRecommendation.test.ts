import { describe, expect, it } from 'vitest';

import {
    recommendContext,
    type ContextCandidateInput,
} from '@/common/learning/contextRecommendation';
import type { VocabularyGuidance } from '@/common/types/vocabulary';

const NOW = Date.parse('2026-01-10T12:00:00.000Z');

const candidate = (
    overrides: Partial<ContextCandidateInput> & Pick<ContextCandidateInput, 'word'>,
): ContextCandidateInput => ({
    surface: overrides.word,
    phonetic: '',
    meaning: '释义',
    tags: [],
    order: 0,
    isUserWord: false,
    status: null,
    mastery: 0,
    confidence: 0,
    dueAt: null,
    lookupCount: 0,
    savedBefore: false,
    ...overrides,
});

const score = (
    candidates: ContextCandidateInput[],
    guidance: VocabularyGuidance = 'coach',
) => recommendContext({
    guidance,
    now: NOW,
    sentenceWordCount: 12,
    contentWords: 7,
    candidates,
});

describe('上下文建议评分', () => {
    it('到期中的用户词优先，并给出到期与记忆理由', () => {
        const result = score([
            candidate({
                word: 'journey',
                isUserWord: true,
                status: 'learning',
                mastery: 0.2,
                dueAt: '2026-01-10T11:00:00.000Z',
            }),
            candidate({ word: 'serendipity', tags: ['cet6'] }),
        ]);

        expect(result.suggestion?.word).toBe('journey');
        expect(result.suggestion?.reasons).toContain('due_now');
        expect(result.suggestion?.reasons).toContain('learning');
        expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
    });

    it('强化模式同样产生主动建议，与教练档的评分口径一致', () => {
        const candidates = [
            candidate({
                word: 'journey',
                isUserWord: true,
                status: 'learning',
                mastery: 0.2,
                dueAt: '2026-01-10T11:00:00.000Z',
            }),
        ];
        const coach = score(candidates, 'coach');
        const intensive = score(candidates, 'intensive');

        expect(intensive.suggestion?.word).toBe('journey');
        expect(intensive.suggestion?.score).toBe(coach.suggestion?.score);
    });

    it('安静模式不产生主动建议，但仍保留候选评分', () => {
        const result = score([
            candidate({
                word: 'journey',
                isUserWord: true,
                status: 'learning',
                mastery: 0.2,
                dueAt: '2026-01-10T11:00:00.000Z',
            }),
        ], 'calm');

        expect(result.candidates).toHaveLength(1);
        expect(result.suggestion).toBeNull();
    });

    it('新词按考纲难度进入建议，过易词不会占用建议位', () => {
        const result = score([
            candidate({ word: 'serendipity', tags: ['cet6'] }),
            candidate({ word: 'bike', tags: ['zk'] }),
        ]);

        expect(result.suggestion?.word).toBe('serendipity');
        expect(result.suggestion?.reasons).toContain('exam_core');
        expect(result.candidates.find((item) => item.word === 'bike')?.score).toBeLessThan(0.35);
    });

    it('之前查过的词会获得个人需求加权', () => {
        const plain = score([
            candidate({ word: 'resilient', tags: ['cet6'] }),
            candidate({ word: 'serendipity', tags: ['cet6'], order: 1 }),
        ]);
        const lookedUp = score([
            candidate({ word: 'resilient', tags: ['cet6'], lookupCount: 3 }),
            candidate({ word: 'serendipity', tags: ['cet6'], order: 1 }),
        ]);

        expect(plain.suggestion?.word).toBe('resilient');
        expect(lookedUp.suggestion?.word).toBe('resilient');
        expect(lookedUp.suggestion?.reasons).toContain('previously_looked_up');
        expect(lookedUp.suggestion?.score).toBeGreaterThan(plain.suggestion?.score ?? 0);
    });

    it('掌握度已高的熟悉词不会被再次推荐', () => {
        const result = score([
            candidate({
                word: 'orbit',
                isUserWord: true,
                status: 'familiar',
                mastery: 0.9,
            }),
        ]);

        expect(result.suggestion).toBeNull();
    });
});
