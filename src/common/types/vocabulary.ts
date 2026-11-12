import type { ReviewRating } from '@/common/types/review';

/**
 * 单词学习状态。
 *
 * - learning: 用户明确要学，或正在学习中；
 * - familiar: 有印象但还不稳定；
 * - known: 用户确认已掌握，或长期稳定回忆；
 * - ignored: 当前不想看到，或与目标无关。
 */
export const WORD_STATUSES = ['learning', 'familiar', 'known', 'ignored'] as const;
export type WordStatus = (typeof WORD_STATUSES)[number];

/**
 * 单词状态来源。
 *
 * default 是产品内置 starter pack，不是用户个人词表；它默认不参与正文标注。
 */
export const WORD_SOURCES = ['manual', 'imported', 'default', 'suggested', 'legacy'] as const;
export type WordSource = (typeof WORD_SOURCES)[number];

/** 会进入正常学习/标注流程的活跃状态。 */
export const ACTIVE_WORD_STATUSES = ['learning', 'familiar'] as const satisfies readonly WordStatus[];

/**
 * 判断状态是否会进入正文标注和推荐候选。
 *
 * @param status 单词状态。
 * @returns learning 或 familiar 时为 true。
 */
export const isActiveWordStatus = (status: WordStatus): boolean =>
    (ACTIVE_WORD_STATUSES as readonly WordStatus[]).includes(status);

/**
 * 单词学习状态快照，供字幕匹配结果与前端状态投影共用。
 */
export interface WordStateSnapshot {
    /** canonical lemma（小写）。 */
    word: string;
    /** 当前学习状态。 */
    status: WordStatus;
    /** 状态来源。 */
    source: WordSource;
}

/**
 * 播放器提示强度。
 *
 * - off: 只保留用户主动查词；
 * - calm: 只标注 learning，不主动推荐；
 * - coach: 标注 learning + familiar，每句最多 1 个建议，自然停顿处给微练习；
 * - intensive: 在 coach 之上收紧节奏（更短的停留阈值与冷却、更高的单次会话
 *   上限），用于用户自己选择的专门学习时段。
 *
 * 四级的差别只在「密度」，不在「能力」：intensive 不会解锁 coach 没有的
 * 提示类型，也不会把建议画到正文上。
 */
export const VOCABULARY_GUIDANCE_LEVELS = ['off', 'calm', 'coach', 'intensive'] as const;
export type VocabularyGuidance = (typeof VOCABULARY_GUIDANCE_LEVELS)[number];

/**
 * 是否会主动给出上下文建议与微练习。
 *
 * calm 与 off 只做被动标注：用户不点词就不打扰。
 *
 * @param guidance 当前提示强度。
 * @returns coach 或 intensive 时为 true。
 */
export const isProactiveGuidance = (guidance: VocabularyGuidance): boolean =>
    guidance === 'coach' || guidance === 'intensive';

/** 单词遭遇事件类型。 */
export const WORD_ENCOUNTER_ACTIONS = [
    'seen',
    'hover',
    'open',
    'lookup',
    'replay',
    'save',
    'known',
    'ignore',
    'shadow',
    'dictation',
    'review',
] as const;
export type WordEncounterAction = (typeof WORD_ENCOUNTER_ACTIONS)[number];

/**
 * 一次单词遭遇的写入参数。
 */
export interface WordEncounterInput {
    /** 句中实际词形。 */
    word: string;
    /** 用户行为。 */
    action: WordEncounterAction;
    /** 当前播放视频标识。 */
    videoId?: string;
    /** 字幕内容哈希。 */
    fileHash?: string;
    /** 句内序号。 */
    sentenceIndex?: number;
    /** 句子内容哈希。 */
    sentenceHash?: string;
    /** 句子上下文。 */
    context?: string;
    /** 跟读/听写得分 0-100。 */
    score?: number;
    /** 复习反馈。 */
    rating?: ReviewRating;
}
