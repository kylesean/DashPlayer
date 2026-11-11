import type { ReviewRating } from '@/common/types/review';
import type { WordStatus } from '@/common/types/vocabulary';

/**
 * 当前掌握概率快照。
 *
 * mastery 是用户“此刻能回忆出来”的概率，confidence 表示这个估计有多少证据。
 * 两者都使用 0-1，UI 只展示经过解释的结论，不直接展示伪精确小数。
 */
export interface MasterySnapshot {
    mastery: number;
    confidence: number;
}

/**
 * 会改变掌握度的学习证据。
 */
export type MasteryEvidence =
    | { kind: 'open' }
    | { kind: 'save' }
    | { kind: 'practice'; score: number }
    | { kind: 'review'; rating: ReviewRating }
    | { kind: 'known' }
    | { kind: 'ignore' };

/**
 * 一次掌握度更新结果。
 */
export interface MasteryUpdate extends MasterySnapshot {
    /** 证据足够明确时给出的状态建议；不确定时为 undefined，避免系统擅自改用户状态。 */
    suggestedStatus?: WordStatus;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 掌握概率衰减的半衰期（天）。
 *
 * 14 天是词表学习的常见量级：两周不复习，掌握概率回落到一半区间。
 */
export const MASTERY_HALF_LIFE_DAYS = 14;

/**
 * 衰减下限。
 *
 * 长期不复习的词会回落到「接近遗忘」，但不直接归零——
 * 归零会让 UI 把它当成全新词，也会让一次新的证据产生不合理的跳变。
 */
export const MASTERY_DECAY_FLOOR = 0.1;

/**
 * 按距离上次遇见的时间衰减掌握概率。
 *
 * 只在读取边界应用，数据库里仍保存原始证据值；因此重复读取不会产生复利，
 * 下次写入新证据时也从「当前时刻的真实估计」继续更新。
 *
 * @param mastery 最近一次写入的掌握概率。
 * @param lastSeenAt 最近一次学习证据时间（ISO 8601）。
 * @param now 当前时间。
 * @returns 衰减后的掌握概率；没有时间信息或时间无法解析时原样返回。
 */
export function decayMastery(
    mastery: number,
    lastSeenAt: string | null | undefined,
    now: Date = new Date(),
): number {
    const value = clamp01(mastery);
    if (!lastSeenAt || value <= 0) {
        return value;
    }
    const lastSeen = Date.parse(lastSeenAt);
    if (Number.isNaN(lastSeen)) {
        return value;
    }
    const elapsedDays = Math.max(0, now.getTime() - lastSeen) / DAY_MS;
    if (elapsedDays === 0) {
        return value;
    }
    const decayed = value * Math.pow(0.5, elapsedDays / MASTERY_HALF_LIFE_DAYS);
    // 只向「不高于当前值」的方向衰减：历史值本就低于下限的词保持原值。
    return Math.max(decayed, Math.min(value, MASTERY_DECAY_FLOOR));
}

/**
 * 读取单词行时的有效掌握度。
 *
 * `known` 是用户的手动裁决，不参与遗忘衰减；其余状态按距上次遇见的时间折算。
 * 仓储读取边界统一使用它，保证词表、复习队列、理解度、图谱与推荐看到同一个值。
 */
export function effectiveWordMastery(
    word: { mastery: number; last_seen_at: string | null; status: WordStatus },
    now: Date = new Date(),
): number {
    if (word.status === 'known') {
        return clamp01(word.mastery);
    }
    return decayMastery(word.mastery, word.last_seen_at, now);
}

/**
 * 将学习行为映射为“观察值 + 证据权重”。
 *
 * 这里刻意采用透明的线性贝叶斯式更新，而不是黑盒模型：
 * - 打开词卡只说明这个词值得帮助，不能当作已经会；
 * - 收藏代表学习意图，不代表掌握；
 * - 跟读/听写与复习评分才是强记忆证据；
 * - 手动“认识 / 忽略”是用户裁决，优先级最高。
 */
const evidenceToObservation = (evidence: MasteryEvidence): {
    observation: number;
    weight: number;
    suggestedStatus?: WordStatus;
} => {
    switch (evidence.kind) {
        case 'open':
            return { observation: 0.35, weight: 0.08 };
        case 'save':
            return { observation: 0.5, weight: 0.1 };
        case 'practice': {
            const observation = clamp01(evidence.score / 100);
            return {
                observation,
                weight: 0.24,
                suggestedStatus: evidence.score >= 85 ? 'familiar' : evidence.score < 40 ? 'learning' : undefined,
            };
        }
        case 'review': {
            const observation = evidence.rating === 'again'
                ? 0.08
                : evidence.rating === 'hard'
                    ? 0.48
                    : evidence.rating === 'good'
                        ? 0.84
                        : 0.96;
            const suggestedStatus: WordStatus | undefined = evidence.rating === 'again'
                ? 'learning'
                : evidence.rating === 'good' || evidence.rating === 'easy'
                    ? 'familiar'
                    : undefined;
            return { observation, weight: evidence.rating === 'again' ? 0.34 : 0.28, suggestedStatus };
        }
        case 'known':
            return { observation: 1, weight: 1, suggestedStatus: 'known' };
        case 'ignore':
            return { observation: 0, weight: 0, suggestedStatus: 'ignored' };
    }
};

/**
 * 应用一次学习证据。
 *
 * @param current 当前掌握度。
 * @param evidence 学习证据。
 * @returns 更新后的掌握概率、置信度与可选的明确状态建议。
 */
export function applyMasteryEvidence(current: MasterySnapshot, evidence: MasteryEvidence): MasteryUpdate {
    const { observation, weight, suggestedStatus } = evidenceToObservation(evidence);
    if (evidence.kind === 'known') {
        return { mastery: 1, confidence: 1, suggestedStatus: 'known' };
    }
    if (evidence.kind === 'ignore') {
        return { ...current, suggestedStatus: 'ignored' };
    }

    const mastery = clamp01(current.mastery + (observation - current.mastery) * weight);
    const confidence = clamp01(1 - (1 - current.confidence) * (1 - weight));
    let nextSuggestion = suggestedStatus;
    if (nextSuggestion === 'familiar' && !(confidence >= 0.38 && mastery >= 0.62)) {
        nextSuggestion = undefined;
    }
    if (nextSuggestion === 'learning' && confidence < 0.3) {
        nextSuggestion = undefined;
    }
    return {
        mastery,
        confidence,
        suggestedStatus: evidence.kind === 'review' && evidence.rating === 'again'
            ? 'learning'
            : nextSuggestion,
    };
}
