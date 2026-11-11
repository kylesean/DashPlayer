import { describe, expect, it } from 'vitest';

import {
    createNewReviewSchedule,
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
            stability: 3650,
            difficulty: 10,
            lastReviewAt: NOW.toISOString(),
            lastRating: 'good',
        }, 'easy', NOW);

        expect(next.stability).toBeLessThanOrEqual(3650);
        expect(next.difficulty).toBeGreaterThanOrEqual(1);
        expect(next.difficulty).toBeLessThanOrEqual(10);
    });

    it('练习分数按四档映射', () => {
        expect(reviewRatingFromPracticeScore(90)).toBe('easy');
        expect(reviewRatingFromPracticeScore(89)).toBe('good');
        expect(reviewRatingFromPracticeScore(75)).toBe('good');
        expect(reviewRatingFromPracticeScore(55)).toBe('hard');
        expect(reviewRatingFromPracticeScore(54)).toBe('again');
    });
});
