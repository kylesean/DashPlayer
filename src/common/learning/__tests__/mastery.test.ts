import { describe, expect, it } from 'vitest';

import {
    applyMasteryEvidence,
    decayMastery,
    effectiveWordMastery,
    MASTERY_DECAY_FLOOR,
    MASTERY_HALF_LIFE_DAYS,
} from '@/common/learning/mastery';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-03-01T00:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

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

describe('decayMastery', () => {
    it('经过一个半衰期后掌握概率减半', () => {
        expect(decayMastery(0.8, daysAgo(MASTERY_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.4, 6);
    });

    it('长期未复习但历史值高的词回落到下限，而不是归零或维持高分', () => {
        const decayed = decayMastery(0.95, daysAgo(365), NOW);

        expect(decayed).toBe(MASTERY_DECAY_FLOOR);
        expect(decayed).toBeGreaterThan(0);
        expect(decayed).toBeLessThan(0.95);
    });

    it('历史值本身低于下限时不因衰减被抬升', () => {
        expect(decayMastery(0.05, daysAgo(365), NOW)).toBe(0.05);
    });

    it('没有时间信息或时间无法解析时保持原值', () => {
        expect(decayMastery(0.7, null, NOW)).toBe(0.7);
        expect(decayMastery(0.7, 'not-a-date', NOW)).toBe(0.7);
    });

    it('重复读取同一份原始值不会产生复利衰减', () => {
        const lastSeenAt = daysAgo(28);

        const first = decayMastery(0.8, lastSeenAt, NOW);
        const second = decayMastery(0.8, lastSeenAt, NOW);

        expect(first).toBeCloseTo(0.2, 6);
        expect(second).toBeCloseTo(first, 10);
    });

    it('时间在未来时不产生增益', () => {
        const future = new Date(NOW.getTime() + 5 * DAY_MS).toISOString();

        expect(decayMastery(0.6, future, NOW)).toBe(0.6);
    });
});

describe('effectiveWordMastery', () => {
    it('known 是用户裁决，不参与遗忘衰减', () => {
        expect(effectiveWordMastery({
            mastery: 1,
            last_seen_at: daysAgo(365),
            status: 'known',
        }, NOW)).toBe(1);
    });

    it('学习中的词按距上次遇见的时间衰减', () => {
        expect(effectiveWordMastery({
            mastery: 0.8,
            last_seen_at: daysAgo(MASTERY_HALF_LIFE_DAYS),
            status: 'learning',
        }, NOW)).toBeCloseTo(0.4, 6);
    });
});
