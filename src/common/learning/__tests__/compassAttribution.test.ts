import { describe, expect, it } from 'vitest';

import {
    adjustWeightsFromAttribution,
    buildAttribution,
    DEFAULT_COMPASS_WEIGHTS,
    reachedStage,
    type AttributionRecord,
} from '@/common/learning/compassAttribution';
import type { ContentCompassReason } from '@/common/types/contentCompass';

const record = (overrides: Partial<AttributionRecord> = {}): AttributionRecord => ({
    videoId: 'v1',
    reason: 'due_review' as ContentCompassReason,
    shownAt: '2026-01-01T00:00:00.000Z',
    openedAt: null,
    reviewedAt: null,
    recalledAt: null,
    dueWords: [],
    ...overrides,
});

describe('reachedStage', () => {
    it('只曝光时停在 shown', () => {
        expect(reachedStage(record())).toBe('shown');
    });

    it('打开后停在 opened', () => {
        expect(reachedStage(record({ openedAt: '2026-01-01T01:00:00.000Z' }))).toBe('opened');
    });

    it('完整链路走到 recalled', () => {
        expect(reachedStage(record({
            openedAt: '2026-01-01T01:00:00.000Z',
            reviewedAt: '2026-01-01T02:00:00.000Z',
            recalledAt: '2026-01-02T02:00:00.000Z',
        }))).toBe('recalled');
    });

    it('顺序颠倒的复习不算数', () => {
        expect(reachedStage(record({
            openedAt: '2026-01-01T02:00:00.000Z',
            reviewedAt: '2026-01-01T01:00:00.000Z',
            recalledAt: '2026-01-02T01:00:00.000Z',
        }))).toBe('opened');
    });

    it('没有打开却有复习时不算走到复习', () => {
        expect(reachedStage(record({ reviewedAt: '2026-01-01T01:00:00.000Z' }))).toBe('shown');
    });
});

describe('buildAttribution', () => {
    it('计数是「至少到达该阶段」的累计值', () => {
        const result = buildAttribution([
            record(),
            record({ openedAt: '2026-01-01T01:00:00.000Z' }),
            record({
                openedAt: '2026-01-01T01:00:00.000Z',
                reviewedAt: '2026-01-01T02:00:00.000Z',
            }),
        ]);
        expect(result.overall.counts).toEqual({ shown: 3, opened: 2, reviewed: 1, recalled: 0 });
    });

    it('按理由分组，并按曝光量降序', () => {
        const result = buildAttribution([
            record({ reason: 'due_review' }),
            record({ reason: 'due_review' }),
            record({ reason: 'interest_match' }),
        ]);
        expect(result.funnels.map((funnel) => funnel.reason)).toEqual([
            'due_review',
            'interest_match',
        ]);
    });

    it('完整转化率是回忆成功除以曝光', () => {
        const result = buildAttribution([
            record({
                openedAt: '2026-01-01T01:00:00.000Z',
                reviewedAt: '2026-01-01T02:00:00.000Z',
                recalledAt: '2026-01-02T02:00:00.000Z',
            }),
            record(),
        ]);
        expect(result.overall.fullConversion).toBe(0.5);
    });

    it('没有曝光时转化率为 null 而不是 0', () => {
        expect(buildAttribution([]).overall.fullConversion).toBeNull();
    });
});

describe('adjustWeightsFromAttribution', () => {
    const many = (reason: ContentCompassReason, count: number, complete: boolean) => (
        Array.from({ length: count }, () => record({
            reason,
            openedAt: complete ? '2026-01-01T01:00:00.000Z' : null,
            reviewedAt: complete ? '2026-01-01T02:00:00.000Z' : null,
            recalledAt: complete ? '2026-01-02T02:00:00.000Z' : null,
        }))
    );

    it('样本不足时原样返回默认权重', () => {
        const result = adjustWeightsFromAttribution(buildAttribution(many('due_review', 3, true)));
        expect(result).toEqual(DEFAULT_COMPASS_WEIGHTS);
    });

    it('调整后权重仍然归一化到 1', () => {
        const records = [...many('due_review', 20, true), ...many('learning_words', 20, false)];
        const result = adjustWeightsFromAttribution(buildAttribution(records));
        const total = result.comprehension + result.dueReview + result.learningWords + result.interest;
        expect(total).toBeCloseTo(1);
    });

    it('转化更好的理由获得更高权重', () => {
        const records = [...many('due_review', 20, true), ...many('learning_words', 20, false)];
        const result = adjustWeightsFromAttribution(buildAttribution(records));
        expect(result.dueReview).toBeGreaterThan(DEFAULT_COMPASS_WEIGHTS.dueReview);
        expect(result.learningWords).toBeLessThan(DEFAULT_COMPASS_WEIGHTS.learningWords);
    });

    it('单次调整不超过 6 个百分点', () => {
        const records = [...many('due_review', 40, true), ...many('learning_words', 40, false)];
        const result = adjustWeightsFromAttribution(buildAttribution(records));
        expect(result.dueReview - DEFAULT_COMPASS_WEIGHTS.dueReview).toBeLessThanOrEqual(0.06);
    });
});
