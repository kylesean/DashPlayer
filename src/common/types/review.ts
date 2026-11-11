import type { WordStatus } from '@/common/types/vocabulary';

/**
 * 一次复习反馈。
 *
 * 四档与 FSRS 的 Again / Hard / Good / Easy 对齐，便于后续替换为完整调度器。
 */
export const REVIEW_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/**
 * 复习卡所处阶段。
 */
export const REVIEW_CARD_STATES = ['new', 'learning', 'review', 'relearning'] as const;
export type ReviewCardState = (typeof REVIEW_CARD_STATES)[number];

/**
 * 调度器保存的复习状态。
 */
export interface ReviewSchedule {
    /** 下次到期时间（ISO 8601）。 */
    dueAt: string;
    /** 当前卡阶段。 */
    state: ReviewCardState;
    /** 完成复习次数。 */
    reps: number;
    /** 遗忘次数。 */
    lapses: number;
    /** 记忆稳定度，单位天。 */
    stability: number;
    /** 难度，1-10，越高越难。 */
    difficulty: number;
    /** 上次复习时间（ISO 8601）；新卡为 null。 */
    lastReviewAt: string | null;
    /** 上次反馈。 */
    lastRating: ReviewRating | null;
}

/**
 * 复习队列中的一张卡。
 */
export interface ReviewCardVO {
    id: number;
    word: string;
    translate: string | null;
    status: WordStatus;
    mastery: number;
    confidence: number;
    schedule: ReviewSchedule;
}

/**
 * 7 / 30 天回忆指标。
 */
export interface ReviewRetentionStats {
    /** 窗口内完成的复习次数。 */
    reviewed: number;
    /** Good / Easy 占比；没有样本时为 null。 */
    retention: number | null;
}

/**
 * 复习坞需要的队列与统计快照。
 */
export interface ReviewQueueVO {
    items: ReviewCardVO[];
    dueCount: number;
    nextDueAt: string | null;
    stats: {
        last7Days: ReviewRetentionStats;
        last30Days: ReviewRetentionStats;
    };
}

/**
 * 复习评分参数。
 */
export interface ReviewRateParams {
    word: string;
    rating: ReviewRating;
}

/**
 * 复习评分结果。
 */
export interface ReviewRateResultVO {
    card: ReviewCardVO;
    /** 评分后同步回词表的状态。 */
    status: WordStatus;
}
