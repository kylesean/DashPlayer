import type {
    VocabularyGuidance,
    WordStatus,
} from '@/common/types/vocabulary';

/**
 * 上下文建议的可解释理由。
 *
 * 后端只返回稳定代码，展示文案由前端 i18n 决定，避免把中文文案写进评分逻辑。
 */
export const CONTEXT_REASON_CODES = [
    'due_now',
    'due_soon',
    'learning',
    'needs_reinforcement',
    'previously_looked_up',
    'saved_before',
    'exam_core',
    'stretch_word',
    'useful_new_word',
] as const;

export type ContextReasonCode = (typeof CONTEXT_REASON_CODES)[number];

/**
 * 句子中的一个 token。
 */
export interface ContextTokenVO {
    text: string;
    lemma: string;
    /** 去掉停用词、数字与标点后的内容词。 */
    isContentWord: boolean;
    order: number;
}

/**
 * 一个候选学习词的上下文快照。
 */
export interface ContextCandidateVO {
    /** canonical lemma。 */
    word: string;
    /** 句中实际出现的词形。 */
    surface: string;
    phonetic: string;
    meaning: string;
    tags: string[];
    /** 是否已在用户词表中。 */
    isUserWord: boolean;
    status: WordStatus | null;
    mastery: number;
    confidence: number;
    /** 复习到期时间；没有卡时为 null。 */
    dueAt: string | null;
    /** 0-1 的可解释综合分。 */
    score: number;
    reasons: ContextReasonCode[];
    /** 句中首次出现顺序。 */
    order: number;
}

/**
 * 一句话的 ContextPack：本地确定性分析结果，不包含 LLM 调用。
 */
export interface ContextPackVO {
    /** 句子内容哈希，用于后续缓存与推荐反馈归因。 */
    sentenceHash: string;
    fileHash?: string;
    sentenceIndex?: number;
    vocabularyRevision: number;
    guidance: VocabularyGuidance;
    tokens: ContextTokenVO[];
    contentWords: number;
    /** 按分数从高到低排列的候选词。 */
    candidates: ContextCandidateVO[];
    /** 本句唯一主动建议；关闭/安静模式或分数不足时为 null。 */
    suggestion: ContextCandidateVO | null;
    density: {
        active: number;
        max: number;
    };
}

/**
 * 查询一句话 ContextPack 的参数。
 */
export interface ContextPackParams {
    text: string;
    fileHash?: string;
    sentenceIndex?: number;
    guidance: VocabularyGuidance;
}
