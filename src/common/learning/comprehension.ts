import type {
    ComprehensionBand,
    ComprehensionDifficulty,
    ComprehensionEstimate,
    ComprehensionEstimateInput,
    ComprehensionWordInput,
} from '@/common/types/subtitleComprehension';

const DIFFICULTY_KNOWN_WEIGHT: Record<ComprehensionDifficulty, number> = {
    basic: 0.94,
    common: 0.76,
    exam: 0.46,
    advanced: 0.24,
    unknown: 0.16,
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * 计算一个词在当前学习者记忆中的已知权重。
 *
 * 用户显式状态优先于词典难度；学习中的词用掌握度连续降权，避免“收藏即掌握”。
 *
 * @param word 内容词输入。
 * @returns 0-1 的已知权重。
 */
const knownWeight = (word: ComprehensionWordInput): number => {
    const mastery = clamp01(word.mastery ?? 0);
    if (word.userStatus === 'known') {
        return 1;
    }
    if (word.userStatus === 'familiar') {
        return Math.min(0.88, 0.42 + mastery * 0.46);
    }
    if (word.userStatus === 'learning') {
        return Math.min(0.62, 0.12 + mastery * 0.5);
    }
    return DIFFICULTY_KNOWN_WEIGHT[word.difficulty];
};

/**
 * 把综合分映射为展示区间。
 *
 * @param score 0-1 的理解概率。
 * @returns 理解度区间。
 */
export const resolveComprehensionBand = (score: number): ComprehensionBand => {
    if (score >= 0.8) {
        return 'high';
    }
    if (score >= 0.58) {
        return 'medium';
    }
    return 'low';
};

/**
 * 估算一句话的直接理解概率。
 *
 * 第一版只使用本地可解释特征：内容词已知率、句长、从句标记与长词比例。
 * 不调用模型，也不依赖网络；结果用于「弱化中文」而不是决定是否允许查看。
 *
 * @param input 内容词与句法特征。
 * @returns 可解释的理解度估算。
 */
export const estimateComprehension = (
    input: ComprehensionEstimateInput,
): ComprehensionEstimate => {
    const contentWords = input.words.length;
    const knownContentRatio = contentWords === 0
        ? 0.7
        : input.words.reduce((sum, word) => sum + knownWeight(word), 0) / contentWords;

    const lengthPenalty = clamp01((input.wordCount - 12) / 30) * 0.3;
    const clausePenalty = Math.min(0.28, Math.max(0, input.clauseCount) * 0.07);
    const longWordRatio = contentWords === 0
        ? 0
        : Math.min(1, Math.max(0, input.longWordCount) / contentWords);
    const syntaxComplexity = clamp01(lengthPenalty + clausePenalty + longWordRatio * 0.42);

    const uncertainWords = input.words
        .filter((word) => knownWeight(word) < 0.5)
        .map((word) => word.lemma);
    const unknownWords = [...new Set(uncertainWords)].slice(0, 8);
    const uncertaintyPenalty = Math.min(0.08, Math.max(0, unknownWords.length - 2) * 0.02);
    const score = clamp01(
        knownContentRatio * 0.82
        + (1 - syntaxComplexity) * 0.18
        - uncertaintyPenalty,
    );

    return {
        score: Number(score.toFixed(3)),
        band: resolveComprehensionBand(score),
        knownContentRatio: Number(knownContentRatio.toFixed(3)),
        syntaxComplexity: Number(syntaxComplexity.toFixed(3)),
        contentWords,
        unknownWords,
    };
};
