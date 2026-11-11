import type { ReviewRetentionStats } from '@/common/types/review';
import type { ComprehensionBand } from '@/common/types/subtitleComprehension';

/** 内容推荐在界面上被用户执行的动作。 */
export const CONTENT_COMPASS_ACTIONS = ['shown', 'opened', 'dismissed', 'reviewed'] as const;
export type ContentCompassAction = (typeof CONTENT_COMPASS_ACTIONS)[number];

/** 推荐理由；前端根据代码渲染本地化文案。 */
export const CONTENT_COMPASS_REASONS = [
    'due_review',
    'learning_words',
    'interest_match',
    'next_step',
] as const;
export type ContentCompassReason = (typeof CONTENT_COMPASS_REASONS)[number];

/**
 * 查询内容指南针参数。
 */
export interface ContentCompassListParams {
    /** 已在首页其他区域展示的视频，避免同屏重复。 */
    excludeVideoIds?: string[];
    /** 返回条数，默认 3。 */
    limit?: number;
}

/**
 * 一条推荐的透明依据。
 */
export interface ContentCompassReasonVO {
    code: ContentCompassReason;
    /** 与本次推荐最相关的用户词，最多 4 个。 */
    words: string[];
    /** 视频中出现的到期复习词数量。 */
    dueCount: number;
    /** 视频中出现的 learning / familiar 词数量。 */
    learningCount: number;
}

/**
 * 内容指南针推荐项。
 */
export interface ContentCompassItemVO {
    videoId: string;
    fileName: string;
    basePath: string;
    srtFile: string;
    currentPosition: number;
    /** 综合排序分 0-1。 */
    score: number;
    /** 本地估算的整片理解度 0-1。 */
    comprehension: number;
    comprehensionBand: ComprehensionBand;
    /** 与最近观看内容的词面相似度 0-1。 */
    interest: number;
    reason: ContentCompassReasonVO;
}

/**
 * 一次内容指南针查询结果。
 */
export interface ContentCompassVO {
    generatedAt: string;
    items: ContentCompassItemVO[];
}

/**
 * 记录一次推荐曝光或反馈。
 */
export interface ContentCompassEventParams {
    videoId: string;
    action: ContentCompassAction;
    score?: number;
    reasonCode?: ContentCompassReason;
    surface?: 'home';
}

/**
 * 查询推荐效果看板参数。
 */
export interface ContentCompassStatsParams {
    /** 统计窗口，默认 7 天。 */
    days?: number;
}

/**
 * 推荐效果看板。
 */
export interface ContentCompassStatsVO {
    since: string;
    shown: number;
    opened: number;
    dismissed: number;
    /** 从推荐直接进入复习的次数。 */
    reviewed: number;
    /** 打开次数 / 曝光次数；没有曝光时为 null。 */
    openRate: number | null;
    /** 不感兴趣次数 / 曝光次数；没有曝光时为 null。 */
    dismissRate: number | null;
    /** 从推荐进入复习的次数 / 含到期词的曝光次数；没有样本时为 null。 */
    reviewRate: number | null;
    /** 同一统计窗口内的复习回忆指标。 */
    retention: ReviewRetentionStats;
}
