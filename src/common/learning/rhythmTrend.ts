import type { SentencePracticeRhythmFeedback } from '@/common/contracts/sentence-practice';

/**
 * 一次跟读的节奏趋势点。
 */
export interface RhythmTrendPoint {
    /** 记录时间（ISO 8601）。 */
    at: string;
    /** 跟读总分，便于把「说顺了」和「说准了」放在一起看。 */
    score: number;
    /** 语速倍率；原句时长未知时为 null。 */
    paceRatio: number | null;
    /** 语速评价。 */
    pace: SentencePracticeRhythmFeedback['pace'];
    /** 音节数偏差（估计值 − 参考值）；任一侧未知时为 null。 */
    syllableDelta: number | null;
    /** 重音错位的词数；无法判断时为 null。 */
    stressShiftedWords: number | null;
}

/**
 * 跨次节奏趋势。
 */
export interface RhythmTrendVO {
    /** 按时间升序排列的点，最多保留最近 N 次。 */
    points: RhythmTrendPoint[];
    /**
     * 趋势结论。
     *
     * `insufficient` 表示样本不足以判断；前端据此不展示趋势箭头，
     * 避免用两次练习的波动讲一个「正在进步」的故事。
     */
    verdict: 'improving' | 'steady' | 'regressing' | 'insufficient';
    /** 语速倍率的变化（最近一次 − 更早一次）；无法比较时为 null。 */
    paceDelta: number | null;
    /** 重音错位词数的变化（负数表示变好）；无法比较时为 null。 */
    stressDelta: number | null;
}

/** 判断趋势所需的最少练习次数。 */
export const RHYTHM_TREND_MIN_SAMPLES = 3;
/** 趋势判定阈值：语速倍率变化超过该值才算「变快/变慢」。 */
const PACE_DELTA_THRESHOLD = 0.12;
/** 重音错位词数变化超过该值才算变化。 */
const STRESS_DELTA_THRESHOLD = 1;

/**
 * 把一条节奏快照折算成趋势点。
 *
 * @param at 记录时间。
 * @param score 本次跟读总分。
 * @param rhythm 节奏快照；没有录音时为 null。
 */
export const toRhythmTrendPoint = (
    at: string,
    score: number,
    rhythm: SentencePracticeRhythmFeedback | null,
): RhythmTrendPoint => {
    if (!rhythm) {
        return { at, score, paceRatio: null, pace: null, syllableDelta: null, stressShiftedWords: null };
    }
    const syllableDelta = rhythm.syllables && rhythm.syllables.verdict !== 'unknown'
        ? rhythm.syllables.estimated - rhythm.syllables.reference
        : null;
    const measurable = rhythm.words.filter((word) => word.stressAligned !== null);
    const stressShiftedWords = measurable.length > 0
        ? measurable.filter((word) => word.stressAligned === false).length
        : null;
    return {
        at,
        score,
        paceRatio: rhythm.paceRatio,
        pace: rhythm.pace,
        syllableDelta,
        stressShiftedWords,
    };
};

/**
 * 计算跨次节奏趋势。
 *
 * 只比较「更早的均值」与「最近的均值」，而不是做线性回归：练习次数通常
 * 只有几次，回归斜率会给出过度精确的假象。样本不足时明确返回 insufficient。
 *
 * @param points 按时间升序排列的趋势点。
 */
export const buildRhythmTrend = (points: readonly RhythmTrendPoint[]): RhythmTrendVO => {
    const usable = points.filter((point) => point.paceRatio !== null);
    if (usable.length < RHYTHM_TREND_MIN_SAMPLES) {
        return {
            points: [...points],
            verdict: 'insufficient',
            paceDelta: null,
            stressDelta: null,
        };
    }
    const half = Math.floor(usable.length / 2);
    const earlier = usable.slice(0, half);
    const recent = usable.slice(-half);
    const mean = (values: number[]): number =>
        values.reduce((sum, value) => sum + value, 0) / values.length;

    const earlierPace = mean(earlier.map((point) => point.paceRatio as number));
    const recentPace = mean(recent.map((point) => point.paceRatio as number));
    // 语速倍率越接近 1 越好；这里只表达「变快/变慢」，不判断哪个更好——
    // 偏快偏慢都可能是问题，具体结论交给 pace 字段。
    const paceDelta = Number((recentPace - earlierPace).toFixed(2));

    const earlierStress = earlier
        .map((point) => point.stressShiftedWords)
        .filter((value): value is number => value !== null);
    const recentStress = recent
        .map((point) => point.stressShiftedWords)
        .filter((value): value is number => value !== null);
    const stressDelta = earlierStress.length > 0 && recentStress.length > 0
        ? Number((mean(recentStress) - mean(earlierStress)).toFixed(2))
        : null;

    let verdict: RhythmTrendVO['verdict'] = 'steady';
    if (stressDelta !== null && Math.abs(stressDelta) >= STRESS_DELTA_THRESHOLD) {
        verdict = stressDelta < 0 ? 'improving' : 'regressing';
    } else if (Math.abs(paceDelta) >= PACE_DELTA_THRESHOLD) {
        // 语速更接近 1 视为改善，离 1 更远视为退步。
        const earlierDistance = Math.abs(earlierPace - 1);
        const recentDistance = Math.abs(recentPace - 1);
        verdict = recentDistance < earlierDistance ? 'improving' : 'regressing';
    }

    return { points: [...points], verdict, paceDelta, stressDelta };
};
