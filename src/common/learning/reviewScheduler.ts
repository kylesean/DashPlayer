import type {
    ReviewCardState,
    ReviewRating,
    ReviewSchedule,
} from '@/common/types/review';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
/** 稳定度上限：一年，避免「easy 几次就排到十年后、实际等于不再复习」。 */
const MAX_STABILITY_DAYS = 365;
/** 累计遗忘次数达到该值即视为 leech（难词）。 */
const LEECH_LAPSES = 4;
/** 难词的稳定度封顶：反复遗忘的词不应获得超长间隔。 */
const LEECH_MAX_STABILITY_DAYS = 60;

const addMs = (now: Date, ms: number): string => new Date(now.getTime() + ms).toISOString();
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * 新卡进入调度器时的初始状态。
 *
 * @param now 当前时间。
 * @returns 立即到期的空卡。
 */
export function createNewReviewSchedule(now: Date = new Date()): ReviewSchedule {
    return {
        dueAt: now.toISOString(),
        state: 'new',
        reps: 0,
        lapses: 0,
        stability: 0,
        difficulty: 0,
        lastReviewAt: null,
        lastRating: null,
    };
}

/**
 * FSRS-lite 的稳定度增长系数。
 *
 * 这组系数没有引入外部依赖，先保证本地、可解释、可测试；
 * 等真实复习数据足够后，再把完整 FSRS 参数拟合接入同一调度接口。
 */
const nextStability = (
    state: ReviewCardState,
    stability: number,
    rating: ReviewRating,
    lapses: number,
): number => {
    const base = Math.max(stability, 0.5);
    // lapses 真正参与决策：反复遗忘的词稳定度增长封顶，避免越忘越久才复习。
    const maxStability = lapses >= LEECH_LAPSES ? LEECH_MAX_STABILITY_DAYS : MAX_STABILITY_DAYS;
    if (rating === 'again') {
        return clamp(base * 0.35, 0.15, maxStability);
    }
    if (rating === 'hard') {
        return clamp(base * (state === 'new' ? 0.8 : 1.2), 0.25, maxStability);
    }
    if (rating === 'good') {
        return clamp(base * (state === 'new' ? 1.8 : 2.2), 0.5, maxStability);
    }
    return clamp(base * (state === 'new' ? 3 : 3.2), 0.5, maxStability);
};

/**
 * 计算下一次复习时间。
 *
 * @param current 当前复习状态。
 * @param rating 用户反馈。
 * @param now 评分时间。
 * @returns 更新后的复习状态。
 */
export function scheduleReview(
    current: ReviewSchedule,
    rating: ReviewRating,
    now: Date = new Date(),
): ReviewSchedule {
    const firstReview = current.state === 'new' || current.reps === 0;
    const previousState = current.state;
    const stability = nextStability(previousState, current.stability, rating, current.lapses);
    const difficultyBase = current.difficulty > 0 ? current.difficulty : 5;
    const difficulty = clamp(
        difficultyBase + (rating === 'again' ? 0.8 : rating === 'hard' ? 0.25 : rating === 'good' ? -0.15 : -0.45),
        1,
        10,
    );

    let nextState: ReviewCardState;
    let delayMs: number;
    if (rating === 'again') {
        nextState = firstReview ? 'learning' : 'relearning';
        delayMs = TEN_MINUTES_MS;
    } else if (firstReview) {
        nextState = 'learning';
        delayMs = rating === 'hard' ? 6 * 60 * 60 * 1000 : rating === 'good' ? DAY_MS : 3 * DAY_MS;
    } else if (previousState === 'learning' || previousState === 'relearning') {
        nextState = 'review';
        delayMs = rating === 'hard' ? 6 * 60 * 60 * 1000 : rating === 'good' ? DAY_MS : 3 * DAY_MS;
    } else {
        nextState = 'review';
        delayMs = Math.max(1, Math.round(stability)) * DAY_MS;
    }

    return {
        dueAt: addMs(now, delayMs),
        state: nextState,
        reps: current.reps + 1,
        lapses: current.lapses + (rating === 'again' ? 1 : 0),
        stability,
        difficulty,
        lastReviewAt: now.toISOString(),
        lastRating: rating,
    };
}

/**
 * 把练习得分映射为复习反馈。
 *
 * @param score 0-100 的跟读/听写得分。
 * @returns 对应的复习档位。
 */
export function reviewRatingFromPracticeScore(score: number): ReviewRating {
    if (score >= 90) return 'easy';
    if (score >= 75) return 'good';
    if (score >= 55) return 'hard';
    return 'again';
}
