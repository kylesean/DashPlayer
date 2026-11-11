import { describe, expect, it } from 'vitest';

import { applyMasteryEvidence } from '@/common/learning/mastery';

describe('applyMasteryEvidence', () => {
    it('打开词卡与收藏只增加证据，不声称用户已经掌握', () => {
        const opened = applyMasteryEvidence({ mastery: 0.4, confidence: 0.2 }, { kind: 'open' });
        const saved = applyMasteryEvidence({ mastery: 0.4, confidence: 0.2 }, { kind: 'save' });

        expect(opened.mastery).toBeLessThan(0.4);
        expect(opened.confidence).toBeGreaterThan(0.2);
        expect(opened.suggestedStatus).toBeUndefined();
        expect(saved.mastery).toBeCloseTo(0.41, 5);
        expect(saved.suggestedStatus).toBeUndefined();
    });

    it('高分练习提升掌握度，证据足够时建议 familiar', () => {
        const result = applyMasteryEvidence(
            { mastery: 0.6, confidence: 0.4 },
            { kind: 'practice', score: 95 },
        );

        expect(result.mastery).toBeGreaterThan(0.6);
        expect(result.confidence).toBeGreaterThan(0.4);
        expect(result.suggestedStatus).toBe('familiar');
    });

    it('低分练习在证据足够时建议回落到 learning', () => {
        const result = applyMasteryEvidence(
            { mastery: 0.7, confidence: 0.5 },
            { kind: 'practice', score: 10 },
        );

        expect(result.mastery).toBeLessThan(0.7);
        expect(result.suggestedStatus).toBe('learning');
    });

    it('复习选择 again 时降低掌握度并强制回到 learning', () => {
        const result = applyMasteryEvidence(
            { mastery: 0.8, confidence: 0.05 },
            { kind: 'review', rating: 'again' },
        );

        expect(result.mastery).toBeLessThan(0.8);
        expect(result.suggestedStatus).toBe('learning');
    });

    it('known 与 ignore 是用户强裁决', () => {
        const known = applyMasteryEvidence(
            { mastery: 0.3, confidence: 0.2 },
            { kind: 'known' },
        );
        const ignored = applyMasteryEvidence(
            { mastery: 0.3, confidence: 0.2 },
            { kind: 'ignore' },
        );

        expect(known).toEqual({ mastery: 1, confidence: 1, suggestedStatus: 'known' });
        expect(ignored).toEqual({ mastery: 0.3, confidence: 0.2, suggestedStatus: 'ignored' });
    });

    it('掌握度始终被限制在 0-1', () => {
        const result = applyMasteryEvidence(
            { mastery: 0.99, confidence: 0.99 },
            { kind: 'review', rating: 'easy' },
        );

        expect(result.mastery).toBeLessThanOrEqual(1);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });
});
