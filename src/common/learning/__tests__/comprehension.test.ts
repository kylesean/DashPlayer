import { describe, expect, it } from 'vitest';

import {
    estimateComprehension,
    resolveComprehensionBand,
} from '@/common/learning/comprehension';
import type { ComprehensionWordInput } from '@/common/types/subtitleComprehension';

const words = (
    values: Array<[string, ComprehensionWordInput['difficulty'], ComprehensionWordInput['userStatus']?]>,
): ComprehensionWordInput[] => values.map(([lemma, difficulty, userStatus]) => ({
    lemma,
    difficulty,
    userStatus,
    mastery: userStatus === 'known' ? 1 : 0.4,
}));

describe('comprehension', () => {
    it('基础短句在已知词足够多时得到高理解度', () => {
        const result = estimateComprehension({
            words: words([
                ['journey', 'basic'],
                ['friend', 'basic'],
                ['home', 'common'],
            ]),
            wordCount: 8,
            clauseCount: 0,
            longWordCount: 0,
        });

        expect(result.band).toBe('high');
        expect(result.knownContentRatio).toBeGreaterThan(0.8);
        expect(result.syntaxComplexity).toBe(0);
    });

    it('大量考纲进阶词与长从句会落到低理解度', () => {
        const result = estimateComprehension({
            words: words([
                ['serendipity', 'advanced'],
                ['ubiquitous', 'advanced'],
                ['notwithstanding', 'exam'],
                ['meticulous', 'exam'],
            ]),
            wordCount: 31,
            clauseCount: 4,
            longWordCount: 4,
        });

        expect(result.band).toBe('low');
        expect(result.syntaxComplexity).toBeGreaterThan(0.6);
        expect(result.unknownWords).toContain('serendipity');
    });

    it('用户标记已掌握会显著抬升理解度', () => {
        const before = estimateComprehension({
            words: words([['serendipity', 'advanced']]),
            wordCount: 10,
            clauseCount: 0,
            longWordCount: 1,
        });
        const after = estimateComprehension({
            words: words([['serendipity', 'advanced', 'known']]),
            wordCount: 10,
            clauseCount: 0,
            longWordCount: 1,
        });

        expect(after.score).toBeGreaterThan(before.score);
        expect(after.band).not.toBe('low');
    });

    it('没有内容词时保持中文辅助而不是误判为完全理解', () => {
        const result = estimateComprehension({
            words: [],
            wordCount: 4,
            clauseCount: 0,
            longWordCount: 0,
        });

        expect(result.band).toBe('medium');
    });

    it('区间阈值稳定', () => {
        expect(resolveComprehensionBand(0.8)).toBe('high');
        expect(resolveComprehensionBand(0.58)).toBe('medium');
        expect(resolveComprehensionBand(0.57)).toBe('low');
    });
});
