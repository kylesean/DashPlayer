import type { ContentCompassReason } from '@/common/types/contentCompass';

/**
 * 参与内容指南针排序的候选视频特征。
 */
export interface ContentCompassRankCandidate {
    id: string;
    /** 用于同目录去重的键。 */
    directoryKey: string;
    comprehensionScore: number;
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
): ContentCompassRankedCandidate[] => {
    const ranked = candidates.map((candidate) => {
        const comprehensionFit = 1 - Math.min(1, Math.abs(candidate.comprehensionScore - 0.78) / 0.6);
        const dueStrength = Math.min(1, candidate.dueWords.length / 3);
        const learningStrength = Math.min(1, candidate.learningWords.length / 5);
        const interestStrength = Math.min(1, candidate.interestScore * 2.5);
        let score = comprehensionFit * 0.44
            + dueStrength * 0.30
            + learningStrength * 0.16
            + interestStrength * 0.10;
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
