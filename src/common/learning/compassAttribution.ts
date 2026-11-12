import type { ContentCompassReason } from '@/common/types/contentCompass';

/**
 * 推荐的四段因果链。
 *
 * 只有走完「曝光 → 打开 → 复习 → 次日回忆成功」才算一次完整归因；
 * 中途断在哪一段比一个笼统的转化率更有用——它直接指出该修哪一环。
 */
export const ATTRIBUTION_STAGES = ['shown', 'opened', 'reviewed', 'recalled'] as const;
export type AttributionStage = (typeof ATTRIBUTION_STAGES)[number];

/**
 * 一次推荐归因记录。
 */
export interface AttributionRecord {
    /** 推荐项的视频 id。 */
    videoId: string;
    /** 推荐理由代码；用于按理由评估哪类推荐真的有效。 */
    reason: ContentCompassReason;
    /** 曝光时间（ISO 8601）。 */
    shownAt: string;
    openedAt: string | null;
    reviewedAt: string | null;
    recalledAt: string | null;
    /** 本次推荐涉及到的到期词；回忆成功按这些词统计。 */
    dueWords: readonly string[];
}

/**
 * 一条归因链路。
 */
export interface AttributionFunnelVO {
    reason: ContentCompassReason;
    /** 各阶段累计次数；逐级递减。 */
    counts: Record<AttributionStage, number>;
    /** 曝光 → 回忆成功的完整转化率；没有曝光时为 null。 */
    fullConversion: number | null;
}

/**
 * 归因结果。
 */
export interface AttributionVO {
    funnels: AttributionFunnelVO[];
    /** 所有理由合并后的整体漏斗。 */
    overall: AttributionFunnelVO;
}

const stageIndex = (stage: AttributionStage): number => ATTRIBUTION_STAGES.indexOf(stage);

/**
 * 计算每条记录走到了哪一阶段。
 *
 * 用「最早达到的阶段」而不是简单看字段非空：链路必须按顺序发生，
 * 一条先复习后打开的记录不应该被算成完整链路。
 */
export const reachedStage = (record: AttributionRecord): AttributionStage => {
    let stage: AttributionStage = 'shown';
    if (record.openedAt) stage = 'opened';
    if (record.openedAt && record.reviewedAt && record.reviewedAt >= record.openedAt) {
        stage = 'reviewed';
    }
    if (
        record.openedAt
        && record.reviewedAt
        && record.recalledAt
        && record.reviewedAt >= record.openedAt
        && record.recalledAt >= record.reviewedAt
    ) {
        stage = 'recalled';
    }
    return stage;
};

const emptyCounts = (): Record<AttributionStage, number> => ({
    shown: 0,
    opened: 0,
    reviewed: 0,
    recalled: 0,
});

/**
 * 汇总一个分组的漏斗。
 *
 * 计数是「至少到达该阶段」的累计值，所以必然逐级递减；这也是
 * 「断在哪一环」能直接读出来的原因。
 */
const summarize = (
    records: readonly AttributionRecord[],
    reason: ContentCompassReason,
): AttributionFunnelVO => {
    const counts = emptyCounts();
    for (const record of records) {
        const reached = stageIndex(reachedStage(record));
        for (let index = 0; index <= reached; index += 1) {
            counts[ATTRIBUTION_STAGES[index]] += 1;
        }
    }
    return {
        reason,
        counts,
        fullConversion: counts.shown === 0 ? null : counts.recalled / counts.shown,
    };
};

/**
 * 按推荐理由汇总因果漏斗。
 *
 * @param records 归因记录。
 * @returns 按曝光量降序排列的各理由漏斗，以及整体漏斗。
 */
export const buildAttribution = (records: readonly AttributionRecord[]): AttributionVO => {
    const byReason = new Map<ContentCompassReason, AttributionRecord[]>();
    for (const record of records) {
        const bucket = byReason.get(record.reason) ?? [];
        bucket.push(record);
        byReason.set(record.reason, bucket);
    }
    const funnels = Array.from(byReason.entries())
        .map(([reason, bucket]) => summarize(bucket, reason))
        .sort((left, right) => right.counts.shown - left.counts.shown);
    // 整体漏斗的 reason 字段只是占位；调用方不应依赖它。
    const overall = summarize(records, 'next_step');
    return { funnels, overall };
};

/**
 * 推荐信号权重。
 */
export interface CompassWeights {
    comprehension: number;
    dueReview: number;
    learningWords: number;
    interest: number;
}

/** 默认权重，与既有排序口径一致。 */
export const DEFAULT_COMPASS_WEIGHTS: CompassWeights = {
    comprehension: 0.44,
    dueReview: 0.30,
    learningWords: 0.16,
    interest: 0.10,
};

/** 单次调整的最大幅度，避免几次点击就把权重推极端。 */
const MAX_ADJUSTMENT = 0.06;
/** 每个理由至少要有这么多次曝光，结论才有意义。 */
const MIN_SAMPLES = 8;

/**
 * 按归因结果反向调整推荐权重。
 *
 * 逻辑刻意保守：
 * - 只有样本足够的理由才参与调整；
 * - 调整量与该理由相对整体转化的差值成正比，且单次不超过 6%；
 * - 权重始终归一化到 1，保持分数可比。
 *
 * 这不是在线学习，也不宣称因果：它只是让「实测有效的信号」慢慢获得
 * 更多话语权，并且每次调整都可从输入数据复现。
 *
 * @param attribution 归因结果。
 * @param base 起始权重。
 * @returns 调整后的权重；样本不足时原样返回 base。
 */
export const adjustWeightsFromAttribution = (
    attribution: AttributionVO,
    base: CompassWeights = DEFAULT_COMPASS_WEIGHTS,
): CompassWeights => {
    const overall = attribution.overall.fullConversion;
    if (overall === null || attribution.overall.counts.shown < MIN_SAMPLES) {
        return { ...base };
    }
    const dueFunnel = attribution.funnels.find((funnel) => funnel.reason === 'due_review');
    const learningFunnel = attribution.funnels.find((funnel) => funnel.reason === 'learning_words');

    const weightFor = (funnel: AttributionFunnelVO | undefined, current: number): number => {
        if (!funnel || funnel.counts.shown < MIN_SAMPLES || funnel.fullConversion === null) {
            return current;
        }
        const delta = Math.max(
            -MAX_ADJUSTMENT,
            Math.min(MAX_ADJUSTMENT, (funnel.fullConversion - overall) * 0.5),
        );
        return Math.max(0.05, current + delta);
    };

    const next: CompassWeights = {
        comprehension: base.comprehension,
        dueReview: weightFor(dueFunnel, base.dueReview),
        learningWords: weightFor(learningFunnel, base.learningWords),
        interest: base.interest,
    };
    const total = next.comprehension + next.dueReview + next.learningWords + next.interest;
    return {
        comprehension: next.comprehension / total,
        dueReview: next.dueReview / total,
        learningWords: next.learningWords / total,
        interest: next.interest / total,
    };
};
