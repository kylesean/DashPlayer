import type { ContentCompassReason } from '@/common/types/contentCompass';

/**
 * 参与内容指南针排序的候选视频特征。
 */
export interface ContentCompassRankCandidate {
    id: string;
    /** 用于同目录去重的键。 */
    directoryKey: string;
    comprehensionScore: number;
    /**
     * 与最近观看主题的相似度。
     *
     * 有本地 embedding 时是语义相似度；模型缺失时退化为词面余弦相似度。
     * 两种来源共用同一个 0-1 区间，排序权重不变。
     */
    interestScore: number;
    dueWords: string[];
    learningWords: string[];
}

/**
 * 排序后的内容指南针候选。
 */
export interface ContentCompassRankedCandidate extends ContentCompassRankCandidate {
    score: number;
    reason: ContentCompassReason;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * 归一化向量，使余弦相似度退化为点积。
 *
 * @param values 原始分量。
 * @returns L2 范数为 1 的向量；零向量原样返回。
 */
export const normalizeVector = (values: readonly number[]): number[] => {
    let norm = 0;
    for (const value of values) {
        norm += value * value;
    }
    if (norm === 0) {
        return values.slice();
    }
    const scale = 1 / Math.sqrt(norm);
    return values.map((value) => value * scale);
};

/**
 * 把多部近期视频的相似度合并为一个兴趣分。
 *
 * 取均值而不是最大值：只看一部最像的视频会让推荐反复围绕同一个主题，
 * 均值更接近「最近的观看重心」。
 *
 * @param similarities 每部近期视频的相似度。
 * @returns 0-1 的兴趣分；没有样本时为 0。
 */
export const aggregateInterestScore = (similarities: readonly number[]): number => {
    if (similarities.length === 0) {
        return 0;
    }
    const total = similarities.reduce((sum, value) => sum + clamp01(value), 0);
    return total / similarities.length;
};

/**
 * 计算两个归一化词频向量的余弦相似度。
 *
 * @param left 左向量。
 * @param right 右向量。
 * @returns 0-1 的相似度；任一向量为空时为 0。
 */
export const lexicalSimilarity = (
    left: ReadonlyMap<string, number>,
    right: ReadonlyMap<string, number>,
): number => {
    if (left.size === 0 || right.size === 0) {
        return 0;
    }
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const value of left.values()) {
        leftNorm += value * value;
    }
    for (const value of right.values()) {
        rightNorm += value * value;
    }
    const smaller = left.size <= right.size ? left : right;
    const larger = smaller === left ? right : left;
    for (const [lemma, value] of smaller) {
        dot += value * (larger.get(lemma) ?? 0);
    }
    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }
    return clamp01(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
};

import {
    DEFAULT_COMPASS_WEIGHTS,
    type CompassWeights,
} from '@/common/learning/compassAttribution';

/**
 * 选择可解释的推荐理由。
 */
const resolveReason = (candidate: ContentCompassRankCandidate): ContentCompassReason => {
    if (candidate.dueWords.length > 0) {
        return 'due_review';
    }
    if (candidate.learningWords.length > 0) {
        return 'learning_words';
    }
    if (candidate.interestScore >= 0.08) {
        return 'interest_match';
    }
    return 'next_step';
};

/**
 * 对候选内容排序，并优先让推荐覆盖不同目录。
 *
 * 分数偏重「理解度接近 i+1」和到期词复现，其次才是学习词与主题相似度。
 *
 * @param candidates 已完成本地字幕分析的候选。
 * @param limit 最多返回数量。
 * @returns 按分数降序、目录尽量分散的推荐。
 */
export const rankContentCompassCandidates = (
    candidates: ContentCompassRankCandidate[],
    limit = 3,
    weights: CompassWeights = DEFAULT_COMPASS_WEIGHTS,
): ContentCompassRankedCandidate[] => {
    const ranked = candidates.map((candidate) => {
        const comprehensionFit = 1 - Math.min(1, Math.abs(candidate.comprehensionScore - 0.78) / 0.6);
        const dueStrength = Math.min(1, candidate.dueWords.length / 3);
        const learningStrength = Math.min(1, candidate.learningWords.length / 5);
        const interestStrength = Math.min(1, candidate.interestScore * 2.5);
        let score = comprehensionFit * weights.comprehension
            + dueStrength * weights.dueReview
            + learningStrength * weights.learningWords
            + interestStrength * weights.interest;
        // 过难内容只在高复现价值时保留，但不应压过更可理解的选择。
        if (candidate.comprehensionScore < 0.35) {
            score *= 0.75;
        }
        return {
            ...candidate,
            score: Number(clamp01(score).toFixed(4)),
            reason: resolveReason(candidate),
        };
    }).sort((left, right) => {
        if (left.score !== right.score) {
            return right.score - left.score;
        }
        if (left.dueWords.length !== right.dueWords.length) {
            return right.dueWords.length - left.dueWords.length;
        }
        return left.id.localeCompare(right.id);
    });

    const picked: ContentCompassRankedCandidate[] = [];
    const pickedIds = new Set<string>();
    const usedDirectories = new Set<string>();
    for (const candidate of ranked) {
        if (picked.length >= limit) {
            break;
        }
        if (usedDirectories.has(candidate.directoryKey)) {
            continue;
        }
        picked.push(candidate);
        pickedIds.add(candidate.id);
        usedDirectories.add(candidate.directoryKey);
    }
    for (const candidate of ranked) {
        if (picked.length >= limit) {
            break;
        }
        if (pickedIds.has(candidate.id)) {
            continue;
        }
        picked.push(candidate);
    }
    return picked;
};
