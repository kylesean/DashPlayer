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
 * 一套学习时刻节奏。
 *
 * 把「多久算停留够了」「两次之间至少隔多久」「一次会话最多几次」打包成
 * 一组常量，强度档位只切换这一组，而不是在判定函数里到处写 if。
 */
export interface LearningMomentCadence {
    /** 暂停后至少停留多久。 */
    minDwellMs: number;
    /** 任意两次之间的最小间隔。 */
    globalCooldownMs: number;
    /** 同一句再次出现的最小间隔。 */
    sentenceCooldownMs: number;
    /** 单次会话上限。 */
    sessionLimit: number;
    /** 超过该掌握度后不再打断。 */
    maxMastery: number;
}

/** `coach` 的节奏：日常观看的默认值。 */
export const COACH_MOMENT_CADENCE: LearningMomentCadence = {
    minDwellMs: LEARNING_MOMENT_MIN_DWELL_MS,
    globalCooldownMs: LEARNING_MOMENT_GLOBAL_COOLDOWN_MS,
    sentenceCooldownMs: LEARNING_MOMENT_SENTENCE_COOLDOWN_MS,
    sessionLimit: LEARNING_MOMENT_SESSION_LIMIT,
    maxMastery: LEARNING_MOMENT_MAX_MASTERY,
};

/**
 * `intensive` 的节奏：专门学习时段。
 *
 * 更短的停留阈值让「想了一下」就够；更短的冷却与更高的上限允许连续处理
 * 多张到期卡；`maxMastery` 不动——掌握度足够高的词本来就不该再打断，
 * 提高密度不等于降低证据门槛。
 */
export const INTENSIVE_MOMENT_CADENCE: LearningMomentCadence = {
    minDwellMs: 2_000,
    globalCooldownMs: 90_000,
    sentenceCooldownMs: 10 * 60_000,
    sessionLimit: 8,
    maxMastery: LEARNING_MOMENT_MAX_MASTERY,
};

/**
 * 按提示强度取对应的节奏。
 *
 * `off` / `calm` 不主动出现，返回 null；调用方据此直接跳过整条链路，
 * 不必自己判断强度。
 *
 * @param guidance 当前提示强度。
 * @returns 对应节奏；不主动提示时为 null。
 */
export const resolveMomentCadence = (
    guidance: string,
): LearningMomentCadence | null => {
    if (guidance === 'intensive') {
        return INTENSIVE_MOMENT_CADENCE;
    }
    if (guidance === 'coach') {
        return COACH_MOMENT_CADENCE;
    }
    return null;
};

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
    /** 节奏；缺省为 `coach`。 */
    cadence?: LearningMomentCadence;
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
 * @param maxMastery 掌握度上限；达到后不再用暂停打断用户。
 * @returns 可用的到期词；没有时为 null。
 */
export const pickDueWordForMoment = (
    candidates: ReadonlyArray<LearningMomentCandidateSource>,
    now: number,
    maxMastery: number = LEARNING_MOMENT_MAX_MASTERY,
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
                && candidate.mastery < maxMastery;
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

    const cadence = input.cadence ?? COACH_MOMENT_CADENCE;
    if (!input.paused) {
        return noPrompt('not_paused');
    }
    if (input.dwellMs < cadence.minDwellMs) {
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
    if (candidate.mastery >= cadence.maxMastery) {
        return noPrompt('mastered');
    }

    const memory = input.memory;
    if (memory) {
        const sameSession = input.sessionKey !== null && memory.sessionKey === input.sessionKey;
        if (sameSession && memory.count >= cadence.sessionLimit) {
            return noPrompt('session_limit');
        }
        const elapsed = input.now - memory.at;
        if (elapsed >= 0 && elapsed < cadence.globalCooldownMs) {
            if (memory.sentenceHash === input.sentenceHash
                && elapsed < cadence.sentenceCooldownMs) {
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
