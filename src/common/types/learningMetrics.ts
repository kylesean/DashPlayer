import type { ReviewRetentionStats } from '@/common/types/review';

/**
 * 学习指标看板的统计窗口。
 *
 * 只提供固定窗口而不是任意日期：成功回忆指标按窗口定义，7/30 天复习成功率
 * 也需要与导出里已有的口径保持一致，避免同一数字出现两种解释。
 */
export type LearningMetricsWindow = 7 | 30;

/**
 * 一项指标。
 *
 * `value` 为 null 表示窗口内没有样本，而不是「0」。展示层必须区分这两者：
 * 0 表示用户确实没有做到，null 表示还没法判断。
 */
export interface LearningMetricVO {
    /** 指标键，前端据此查本地化文案。 */
    key: LearningMetricKey;
    /** 指标数值；比率类为 0–1。 */
    value: number | null;
    /** 分子（有意义的计数指标才有）。 */
    numerator?: number;
    /** 分母（有意义的计数指标才有）。 */
    denominator?: number;
}

/** 看板上的指标键。 */
export const LEARNING_METRIC_KEYS = [
    'weeklyRecallWords',
    'retention7',
    'retention30',
    'reviewCompletion',
    'recommendationOpen',
    'feedbackRate',
    'dueBacklog',
    'practiceCoverage',
    'interventionsPerTenMinutes',
    'continueAfterSession',
] as const;
export type LearningMetricKey = (typeof LEARNING_METRIC_KEYS)[number];

/**
 * 学习指标看板。
 *
 * 全部指标只读本地数据库，不调用模型、不访问网络；口径见各字段注释，
 * 前端不做二次计算，避免同一指标在两个地方各算一遍。
 */
export interface LearningMetricsVO {
    generatedAt: string;
    /** 主窗口；默认 7 天。 */
    windowDays: LearningMetricsWindow;
    /**
     * 成功回忆指标：窗口内至少成功回忆过一次的 learning 词数。
     *
     * 只统计 `review` 事件里评级为 good / easy 的**去重词数**，同一词在窗口内
     * 复习多次只算一次——它衡量的是「记住了多少个词」，不是「复习了多少次」。
     */
    northStar: LearningMetricVO;
    /** 辅助指标，顺序固定，前端直接按序渲染。 */
    metrics: LearningMetricVO[];
    /** 7 / 30 天回忆留存，与学习数据导出使用同一口径。 */
    retention: {
        last7Days: ReviewRetentionStats;
        last30Days: ReviewRetentionStats;
    };
    /**
     * 因缺少数据源而暂不提供的指标。
     *
     * 明确列出而不是静默省略：看板上少一个数字时，用户和开发者都应该知道
     * 是「没采集」而不是「算出来是 0」。
     */
    unavailable: LearningMetricKey[];
}

/** 指标看板查询参数。 */
export interface LearningMetricsParams {
    /** 统计窗口，默认 7 天。 */
    windowDays?: LearningMetricsWindow;
}
