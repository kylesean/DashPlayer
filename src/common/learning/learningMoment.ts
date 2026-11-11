import type { WordStatus } from '@/common/types/vocabulary';

/** 用户暂停后至少停留多久，才考虑一次学习时刻。 */
export const LEARNING_MOMENT_MIN_DWELL_MS = 5_000;

/** 任意两次学习时刻之间的最小间隔。 */
export const LEARNING_MOMENT_GLOBAL_COOLDOWN_MS = 5 * 60_000;

/** 同一句字幕再次出现学习时刻的最小间隔。 */
export const LEARNING_MOMENT_SENTENCE_COOLDOWN_MS = 30 * 60_000;

/** 单次播放会话最多主动出现的微回忆次数。 */
export const LEARNING_MOMENT_SESSION_LIMIT = 3;

/** 掌握度达到该值后，不再用一次暂停打断用户。 */
export const LEARNING_MOMENT_MAX_MASTERY = 0.6;

/**
 * 可进入学习时刻的候选词。
 *
 * 只接受已到期、仍在学习中的词；已掌握或忽略的词不参与。
 */
export interface LearningMomentCandidate {
    word: string;
    surface: string;
    phonetic: string;
    meaning: string;
    status: 'learning' | 'familiar';
    mastery: number;
    dueAt: string;
    score: number;
}

/**
 * 学习时刻的本地记忆，用于跨组件重挂载与跨会话限频。
 */
export interface LearningMomentMemory {
    /** 上次出现学习时刻的时间戳（毫秒）。 */
    at: number;
    /** 上次出现学习时刻的句子键。 */
    sentenceHash: string;
    /** 上次出现学习时刻的播放会话键。 */
    sessionKey: string;
    /** 当前播放会话内已出现的学习时刻次数。 */
    count: number;
}

/**
 * 不出现学习时刻的原因；`due_word` 表示可以出现。
 */
export type LearningMomentReason =
    | 'due_word'
    | 'not_paused'
    | 'dwell'
    | 'no_due_word'
    | 'not_due'
    | 'mastered'
    | 'global_cooldown'
    | 'sentence_cooldown'
    | 'session_limit';

/**
 * 学习时刻决策结果。
 */
export interface LearningMomentDecision {
    shouldPrompt: boolean;
    reason: LearningMomentReason;
    candidate: LearningMomentCandidate | null;
}

/**
 * 学习时刻决策输入。
 */
export interface LearningMomentInput {
    paused: boolean;
    dwellMs: number;
    now: number;
    sentenceHash: string;
    sessionKey: string | null;
    candidate: LearningMomentCandidate | null;
    memory: LearningMomentMemory | null;
}

/**
 * ContextPack 候选词中与学习时刻相关的最小字段。
 */
export interface LearningMomentCandidateSource {
    word: string;
    surface: string;
    phonetic: string;
    meaning: string;
    status: WordStatus | null;
    mastery: number;
    dueAt: string | null;
    score: number;
}

const isActiveStatus = (
    status: WordStatus | null,
): status is LearningMomentCandidate['status'] => (
    status === 'learning' || status === 'familiar'
);

/**
 * 从 ContextPack 候选中挑出最适合微回忆的到期词。
 *
 * 优先最早到期，其次优先当前句得分更高的词；只返回一个，避免暂停后
 * 连续追问。掌握度较高或尚未到期的词不会进入微回忆。
 *
 * @param candidates ContextPack 候选词。
 * @param now 当前时间戳（毫秒）。
 * @returns 可用的到期词；没有时为 null。
 */
export const pickDueWordForMoment = (
    candidates: ReadonlyArray<LearningMomentCandidateSource>,
    now: number,
): LearningMomentCandidate | null => {
    const eligible = candidates
        .filter((candidate): candidate is LearningMomentCandidateSource & {
            status: LearningMomentCandidate['status'];
            dueAt: string;
        } => {
            if (!isActiveStatus(candidate.status) || !candidate.dueAt) {
                return false;
            }
            const dueAt = Date.parse(candidate.dueAt);
            return Number.isFinite(dueAt)
                && dueAt <= now
                && candidate.mastery < LEARNING_MOMENT_MAX_MASTERY;
        })
        .sort((left, right) => (
            Date.parse(left.dueAt) - Date.parse(right.dueAt)
            || right.score - left.score
            || left.word.localeCompare(right.word)
        ));
    const top = eligible[0];
    if (!top) {
        return null;
    }
    return {
        word: top.word,
        surface: top.surface,
        phonetic: top.phonetic,
        meaning: top.meaning,
        status: top.status,
        mastery: top.mastery,
        dueAt: top.dueAt,
        score: top.score,
    };
};

/**
 * 判断暂停中的当前句是否值得出现一次到期词微回忆。
 *
 * 决策完全本地、确定性：暂停停留、到期状态、掌握度与限频共同决定，
 * 不调用模型，也不改变任何学习数据。真正提交复习由用户点击后触发。
 *
 * @param input 播放、候选词与本地记忆。
 * @returns 是否出现以及可解释的原因。
 */
export const evaluateLearningMoment = (
    input: LearningMomentInput,
): LearningMomentDecision => {
    const noPrompt = (
        reason: Exclude<LearningMomentReason, 'due_word'>,
    ): LearningMomentDecision => ({
        shouldPrompt: false,
        reason,
        candidate: null,
    });

    if (!input.paused) {
        return noPrompt('not_paused');
    }
    if (input.dwellMs < LEARNING_MOMENT_MIN_DWELL_MS) {
        return noPrompt('dwell');
    }
    const candidate = input.candidate;
    if (!candidate || !isActiveStatus(candidate.status)) {
        return noPrompt('no_due_word');
    }
    const dueAt = Date.parse(candidate.dueAt);
    if (!Number.isFinite(dueAt) || dueAt > input.now) {
        return noPrompt('not_due');
    }
    if (candidate.mastery >= LEARNING_MOMENT_MAX_MASTERY) {
        return noPrompt('mastered');
    }

    const memory = input.memory;
    if (memory) {
        const sameSession = input.sessionKey !== null && memory.sessionKey === input.sessionKey;
        if (sameSession && memory.count >= LEARNING_MOMENT_SESSION_LIMIT) {
            return noPrompt('session_limit');
        }
        const elapsed = input.now - memory.at;
        if (elapsed >= 0 && elapsed < LEARNING_MOMENT_GLOBAL_COOLDOWN_MS) {
            if (memory.sentenceHash === input.sentenceHash
                && elapsed < LEARNING_MOMENT_SENTENCE_COOLDOWN_MS) {
                return noPrompt('sentence_cooldown');
            }
            return noPrompt('global_cooldown');
        }
    }

    return {
        shouldPrompt: true,
        reason: 'due_word',
        candidate,
    };
};
