import { describe, expect, it } from 'vitest';

import {
    buildForgettingCurvePoints,
    createNewReviewSchedule,
    estimateRetrievability,
    reviewRatingFromPracticeScore,
    scheduleReview,
} from '@/common/learning/reviewScheduler';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('reviewScheduler', () => {
    it('新卡选择 good 后进入 learning 并把到期时间推后一天', () => {
        const next = scheduleReview(createNewReviewSchedule(NOW), 'good', NOW);

        expect(next.state).toBe('learning');
        expect(next.reps).toBe(1);
        expect(next.lastRating).toBe('good');
        expect(Date.parse(next.dueAt) - NOW.getTime()).toBe(DAY_MS);
        expect(next.stability).toBeGreaterThan(0);
    });

    it('again 会让新卡在 10 分钟后重来并累计 lapse', () => {
        const next = scheduleReview(createNewReviewSchedule(NOW), 'again', NOW);

        expect(next.state).toBe('learning');
        expect(next.lapses).toBe(1);
        expect(Date.parse(next.dueAt) - NOW.getTime()).toBe(10 * 60 * 1000);
        expect(next.stability).toBeLessThan(0.5);
    });

    it('稳定卡选择 good 按稳定度推后到期日', () => {
        const next = scheduleReview({
            dueAt: NOW.toISOString(),
            state: 'review',
            reps: 3,
            lapses: 0,
            stability: 4,
            difficulty: 5,
            lastReviewAt: NOW.toISOString(),
            lastRating: 'good',
        }, 'good', NOW);

        expect(next.state).toBe('review');
        expect(next.stability).toBeCloseTo(8.8, 5);
        expect(Date.parse(next.dueAt) - NOW.getTime()).toBe(9 * DAY_MS);
    });

    it('稳定度与难度始终落在调度器边界内', () => {
        const next = scheduleReview({
            dueAt: NOW.toISOString(),
            state: 'review',
            reps: 10,
            lapses: 0,
            stability: 365,
            difficulty: 10,
            lastReviewAt: NOW.toISOString(),
            lastRating: 'good',
        }, 'easy', NOW);

        expect(next.stability).toBe(365);
        expect(Date.parse(next.dueAt) - NOW.getTime()).toBe(365 * DAY_MS);
        expect(next.difficulty).toBeGreaterThanOrEqual(1);
        expect(next.difficulty).toBeLessThanOrEqual(10);
    });

    it('lapses 达到 4 后稳定度增长封顶 60 天', () => {
        const leech = scheduleReview({
            dueAt: NOW.toISOString(),
            state: 'review',
            reps: 8,
            lapses: 4,
            stability: 100,
            difficulty: 5,
            lastReviewAt: NOW.toISOString(),
            lastRating: 'good',
        }, 'good', NOW);
        const normal = scheduleReview({
            dueAt: NOW.toISOString(),
            state: 'review',
            reps: 8,
            lapses: 3,
            stability: 100,
            difficulty: 5,
            lastReviewAt: NOW.toISOString(),
            lastRating: 'good',
        }, 'good', NOW);

        expect(leech.stability).toBe(60);
        expect(Date.parse(leech.dueAt) - NOW.getTime()).toBe(60 * DAY_MS);
        expect(normal.stability).toBeCloseTo(220, 5);
    });

    it('练习分数按四档映射', () => {
        expect(reviewRatingFromPracticeScore(90)).toBe('easy');
        expect(reviewRatingFromPracticeScore(89)).toBe('good');
        expect(reviewRatingFromPracticeScore(75)).toBe('good');
        expect(reviewRatingFromPracticeScore(55)).toBe('hard');
        expect(reviewRatingFromPracticeScore(54)).toBe('again');
    });

    it('estimateRetrievability 在复习当天接近 100%，随天数单调下降', () => {
        const reviewed = scheduleReview(createNewReviewSchedule(NOW), 'good', NOW);
        const atDay0 = estimateRetrievability(reviewed, NOW);
        const atDay1 = estimateRetrievability(reviewed, new Date(NOW.getTime() + DAY_MS));
        const atDay10 = estimateRetrievability(reviewed, new Date(NOW.getTime() + 10 * DAY_MS));

        expect(atDay0).toBe(1);
        expect(atDay1).not.toBeNull();
        expect(atDay10).not.toBeNull();
        expect(atDay1!).toBeLessThan(atDay0!);
        expect(atDay10!).toBeLessThan(atDay1!);
        expect(atDay10!).toBeGreaterThanOrEqual(0);
    });

    it('buildForgettingCurvePoints 返回单调递减的 0-30 天采样点', () => {
        const points = buildForgettingCurvePoints(7);
        expect(points.length).toBeGreaterThanOrEqual(5);
        expect(points[0]).toEqual({ day: 0, retention: 1 });
        expect(points[points.length - 1].day).toBe(30);
        expect(points[points.length - 1].retention).toBeLessThan(points[0].retention);
    });
});
