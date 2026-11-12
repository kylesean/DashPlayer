import { describe, expect, it, vi } from 'vitest';

import { LearningMetricsServiceImpl } from '@/backend/services/LearningMetricsService';

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeedOptions {
    reviewEvents?: unknown[];
    encounters?: unknown[];
    userWords?: unknown[];
    dueCount?: number;
    recommendationEvents?: unknown[];
    reviewOutcomes?: unknown[];
}

/**
 * 构造仓储桩：只实现指标服务用到的方法。
 */
const buildService = (overrides: SeedOptions = {}) => {
    const repository = {
        listReviewEventsSince: vi.fn(async () => overrides.reviewEvents ?? []),
        listEncountersSince: vi.fn(async () => overrides.encounters ?? []),
        listUserWords: vi.fn(async () => overrides.userWords ?? []),
        listRecommendationEventsSince: vi.fn(async () => overrides.recommendationEvents ?? []),
        listReviewOutcomesSince: vi.fn(async () => overrides.reviewOutcomes ?? []),
    };
    const reviewCardRepository = {
        countDue: vi.fn(async () => overrides.dueCount ?? 0),
    };
    const service = new LearningMetricsServiceImpl(
        repository as never,
        reviewCardRepository as never,
    );
    return { service, repository, reviewCardRepository };
};

describe('LearningMetricsService', () => {
    it('默认窗口为 7 天，并支持 30 天', async () => {
        const { service } = buildService();
        expect((await service.getMetrics()).windowDays).toBe(7);
        expect((await service.getMetrics({ windowDays: 30 })).windowDays).toBe(30);
    });

    it('北极星指标按 lemma 去重，只计成功回忆', async () => {
        const { service } = buildService({
            reviewEvents: [
                { lemma: 'grasp', rating: 'good' },
                { lemma: 'grasp', rating: 'easy' },
                { lemma: 'elusive', rating: 'again' },
            ],
        });
        const result = await service.getMetrics();
        expect(result.northStar.value).toBe(1);
    });

    it('推荐指标按视频×自然日去重，与内容指南针口径一致', async () => {
        const today = new Date().toISOString();
        const { service } = buildService({
            recommendationEvents: [
                { video_id: 'v1', action: 'shown', created_at: today },
                { video_id: 'v1', action: 'shown', created_at: today },
                { video_id: 'v1', action: 'opened', created_at: today },
                { video_id: 'v2', action: 'shown', created_at: today },
            ],
        });
        const result = await service.getMetrics();
        const openMetric = result.metrics.find((metric) => metric.key === 'recommendationOpen');
        expect(openMetric?.denominator).toBe(2);
        expect(openMetric?.numerator).toBe(1);
        expect(openMetric?.value).toBeCloseTo(0.5);
    });

    it('默认词表与已忽略词不进入活跃词分母', async () => {
        const { service } = buildService({
            userWords: [
                { word: 'grasp', status: 'learning', source: 'manual' },
                { word: 'the', status: 'learning', source: 'default' },
                { word: 'retired', status: 'ignored', source: 'manual' },
                { word: 'known', status: 'known', source: 'manual' },
            ],
        });
        const result = await service.getMetrics();
        const feedback = result.metrics.find((metric) => metric.key === 'feedbackRate');
        expect(feedback?.denominator).toBe(1);
    });

    it('到期积压直接作为库存指标返回', async () => {
        const { service } = buildService({ dueCount: 7 });
        const result = await service.getMetrics();
        const backlog = result.metrics.find((metric) => metric.key === 'dueBacklog');
        expect(backlog?.value).toBe(7);
    });

    it('留存指标复用导出同一口径，并与辅助指标一致', async () => {
        const { service } = buildService({
            reviewOutcomes: [
                { rating: 'good', score: null },
                { rating: 'again', score: null },
            ],
        });
        const result = await service.getMetrics();
        expect(result.retention.last7Days.reviewed).toBe(2);
        expect(result.retention.last7Days.retention).toBeCloseTo(0.5);
        const retention7 = result.metrics.find((metric) => metric.key === 'retention7');
        expect(retention7?.value).toBeCloseTo(0.5);
    });

    it('缺数据源的指标被显式标注', async () => {
        const { service } = buildService();
        const result = await service.getMetrics();
        expect(result.unavailable).toContain('interventionsPerTenMinutes');
        expect(result.unavailable).toContain('continueAfterSession');
    });

    it('窗口查询使用 ISO 时间，且确实回看整个窗口', async () => {
        const { service, repository } = buildService();
        await service.getMetrics({ windowDays: 30 });
        const since = repository.listReviewEventsSince.mock.calls[0][0] as string;
        expect(since).toBe(new Date(since).toISOString());
        const ageDays = (Date.now() - new Date(since).getTime()) / DAY_MS;
        expect(ageDays).toBeGreaterThan(29.9);
        expect(ageDays).toBeLessThan(30.1);
    });
});
