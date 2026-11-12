import type { WordStatus } from '@/common/types/vocabulary';
import type {
    LearningMetricKey,
    LearningMetricVO,
} from '@/common/types/learningMetrics';
import type { ReviewEventRow } from '@/common/types/review';

/**
 * 指标聚合只需要事件里的这几个字段。
 *
 * 用结构化类型而不是直接引用数据库行：纯函数不该知道表结构，
 * 测试也不必为了算一个比率去构造整行。
 */
export interface MetricEncounter {
    lemma: string;
    action: string;
    created_at: string;
}

/** 参与「主动反馈率」的动作：用户明确表达了对这个词的判断。 */
const FEEDBACK_ACTIONS = ['known', 'ignore'] as const;

/** 参与「练习覆盖」的动作：用户真的开口或动笔了。 */
const PRACTICE_ACTIONS = ['shadow', 'dictation', 'retell', 'roleplay', 'review'] as const;

/** 只有这两种评级才算「成功回忆」，与留存指标口径一致。 */
const SUCCESSFUL_RATINGS = new Set(['good', 'easy']);

const isSuccessfulReview = (rating: string | null): boolean =>
    rating !== null && SUCCESSFUL_RATINGS.has(rating);

const ratio = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;

/**
 * 成功回忆指标：窗口内至少成功回忆过一次的去重词数。
 *
 * 按 lemma 去重而不是按事件计数：一个词复习五次只说明它难，不说明记住了五个词。
 */
export function countRecalledWords(events: readonly ReviewEventRow[]): number {
    const recalled = new Set<string>();
    for (const event of events) {
        if (isSuccessfulReview(event.rating)) {
            recalled.add(event.lemma.toLowerCase());
        }
    }
    return recalled.size;
}

/**
 * 复习完成率：窗口内到期并被处理的比例。
 *
 * 分子是窗口内的复习次数，分母是「窗口内复习次数 + 当前仍到期未处理的卡数」。
 * 这个口径不追求绝对精确，只保证不会算出大于 100% 的数：已经复习过的卡不在
 * 当前到期集合里，两者天然不重叠。
 */
export function reviewCompletionRate(
    reviewCount: number,
    dueBacklog: number,
): number | null {
    return ratio(reviewCount, reviewCount + dueBacklog);
}

/**
 * 主动反馈率：在窗口内的学习词中，用户明确标记认识或忽略的比例。
 *
 * 分母只算「有反馈价值」的活跃词（learning / familiar），已掌握或已忽略的词
 * 不再需要用户判断，纳入分母会稀释这个数字。
 */
export function feedbackRate(
    events: readonly MetricEncounter[],
    activeWords: readonly { word: string; status: WordStatus }[],
): number | null {
    if (activeWords.length === 0) {
        return null;
    }
    const active = new Set(activeWords.map((word) => word.word.toLowerCase()));
    const fedBack = new Set<string>();
    for (const event of events) {
        if (!FEEDBACK_ACTIONS.includes(event.action as (typeof FEEDBACK_ACTIONS)[number])) {
            continue;
        }
        const lemma = event.lemma.toLowerCase();
        if (active.has(lemma)) {
            fedBack.add(lemma);
        }
    }
    return fedBack.size / active.size;
}

/**
 * 练习覆盖率：窗口内的活跃词中，至少被跟读 / 听写 / 复习过一次的比例。
 */
export function practiceCoverage(
    events: readonly MetricEncounter[],
    activeWords: readonly { word: string; status: WordStatus }[],
): number | null {
    if (activeWords.length === 0) {
        return null;
    }
    const active = new Set(activeWords.map((word) => word.word.toLowerCase()));
    const practiced = new Set<string>();
    for (const event of events) {
        if (!PRACTICE_ACTIONS.includes(event.action as (typeof PRACTICE_ACTIONS)[number])) {
            continue;
        }
        const lemma = event.lemma.toLowerCase();
        if (active.has(lemma)) {
            practiced.add(lemma);
        }
    }
    return practiced.size / active.size;
}

/** 看板需要的原始输入。 */
export interface LearningMetricsInput {
    windowDays: number;
    reviewEvents: readonly ReviewEventRow[];
    encounters: readonly MetricEncounter[];
    activeWords: readonly { word: string; status: WordStatus }[];
    dueBacklog: number;
    recommendationShown: number;
    recommendationOpened: number;
    retention7: number | null;
    retention30: number | null;
    retention7Reviewed: number;
    retention30Reviewed: number;
}

/**
 * 把原始数据折算成看板指标。
 *
 * 纯函数：所有输入由调用方查询后传入，便于用构造数据覆盖边界（无样本、
 * 分母为 0、同一词多次复习）而不必搭数据库。
 */
export function buildLearningMetrics(input: LearningMetricsInput): {
    northStar: LearningMetricVO;
    metrics: LearningMetricVO[];
    unavailable: LearningMetricKey[];
} {
    const recalledWords = countRecalledWords(input.reviewEvents);
    const reviewCount = input.reviewEvents.length;
    const northStar: LearningMetricVO = {
        key: 'weeklyRecallWords',
        value: recalledWords,
        numerator: recalledWords,
    };
    const metrics: LearningMetricVO[] = [
        {
            key: 'retention7',
            value: input.retention7,
            numerator: input.retention7Reviewed,
        },
        {
            key: 'retention30',
            value: input.retention30,
            numerator: input.retention30Reviewed,
        },
        {
            key: 'reviewCompletion',
            value: reviewCompletionRate(reviewCount, input.dueBacklog),
            numerator: reviewCount,
            denominator: reviewCount + input.dueBacklog,
        },
        {
            key: 'recommendationOpen',
            value: ratio(input.recommendationOpened, input.recommendationShown),
            numerator: input.recommendationOpened,
            denominator: input.recommendationShown,
        },
        {
            key: 'feedbackRate',
            value: feedbackRate(input.encounters, input.activeWords),
            denominator: input.activeWords.length,
        },
        {
            key: 'dueBacklog',
            value: input.dueBacklog,
        },
        {
            key: 'practiceCoverage',
            value: practiceCoverage(input.encounters, input.activeWords),
            denominator: input.activeWords.length,
        },
    ];
    // 这两项需要「播放时长」与「会话结束后是否继续观看」的原始信号，
    // 当前没有任何表记录播放时长，因此明确标注为不可用而不是伪造近似值。
    const unavailable: LearningMetricKey[] = [
        'interventionsPerTenMinutes',
        'continueAfterSession',
    ];
    return { northStar, metrics, unavailable };
}
