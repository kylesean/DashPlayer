import type { LearningSessionSummaryVO } from '@/common/types/learningSession';

/** 复盘内容的生成来源。 */
export type LearningRecapSource = 'ai' | 'local';

/**
 * 本次学习复盘参数。
 */
export interface LearningRecapParams {
    videoId?: string;
    fileHash?: string;
    /** 会话开始时间（ISO 8601）。 */
    since: string;
    /** 说明文字使用的前端语言。 */
    locale?: 'zh-CN' | 'en-US';
    /** 是否绕过缓存重新生成。 */
    forceRefresh?: boolean;
}

/** 复盘中的一个目标词。 */
export interface LearningRecapWordVO {
    word: string;
    translate: string | null;
    /** AI 生成的记忆钩子；本地回退时为空。 */
    note: string | null;
}

/** 复盘中的一句话。 */
export interface LearningRecapSentenceVO {
    text: string;
    /** AI 生成的回顾说明；本地回退时为空。 */
    note: string | null;
}

/** 复盘中的一个实用表达。 */
export interface LearningRecapExpressionVO {
    text: string;
    meaning: string;
}

/**
 * 复盘中的一次书面场景回应。
 *
 * 开场白始终来自真实字幕；`scenario` 与 `prompt` 为空时由前端使用本地化模板。
 */
export interface LearningRecapRolePlayVO {
    /** 场景说明；本地回退时为空。 */
    scenario: string;
    /** 对方开场白，必须是本次会话中的真实字幕句。 */
    openingLine: string;
    /** 回应提示；本地回退时为空。 */
    prompt: string;
    /** 希望用户在回应中使用的表达，最多 3 个。 */
    targetExpressions: LearningRecapExpressionVO[];
}

/**
 * 一次播放会话的学习复盘。
 *
 * AI 可用时由模型在会话词与真实字幕句内组织内容；不可用或输出越界时
 * 回退为本地确定性摘要，入口与导出结果保持同一结构。
 */
export interface LearningRecapVO {
    since: string;
    source: LearningRecapSource;
    cached: boolean;
    /** 一句话总览；本地回退时为空，由前端使用本地化文案。 */
    headline: string;
    words: LearningRecapWordVO[];
    sentence: LearningRecapSentenceVO | null;
    expression: LearningRecapExpressionVO | null;
    /** 口语任务；本地回退时为空，由前端使用本地化模板。 */
    speakingTask: string;
    /** 场景回应练习；没有真实字幕句时为空。 */
    rolePlay?: LearningRecapRolePlayVO | null;
    counts: LearningSessionSummaryVO['counts'];
}

/** 复述反馈等级。 */
export type RetellLevel = 'great' | 'good' | 'retry';

/**
 * 复述检查参数。
 */
export interface RetellEvaluationParams {
    /** 原字幕句。 */
    original: string;
    /** 用户写下的复述。 */
    response: string;
    locale?: 'zh-CN' | 'en-US';
    /** 是否绕过缓存重新检查。 */
    forceRefresh?: boolean;
}

/**
 * 复述检查结果。
 *
 * `coverage` 等关键词信号始终由本地计算，作为可解释的辅助证据；
 * AI 可用时在同等事实基础上给出更自然的点评与改写。
 */
export interface RetellEvaluationVO {
    level: RetellLevel;
    /** AI 点评；本地回退时为空，由前端按等级渲染本地化提示。 */
    feedback: string;
    /** 更自然的英文复述；本地回退时为空。 */
    improved: string;
    /** 原句内容词覆盖率 0-1。 */
    coverage: number;
    matchedKeywords: number;
    totalKeywords: number;
    /** 未被复述覆盖的关键词，最多 5 个。 */
    missingWords: string[];
    source: LearningRecapSource;
    cached: boolean;
}

/**
 * 场景回应检查参数。
 */
export interface RolePlayFeedbackParams {
    /** 场景说明，仅作为点评上下文。 */
    scenario?: string;
    /** 对方开场白，必须是真实字幕句。 */
    openingLine: string;
    /** 用户写下的回应。 */
    response: string;
    /** 希望用户用上的表达。 */
    targetExpressions?: string[];
    locale?: 'zh-CN' | 'en-US';
    /** 是否绕过缓存重新检查。 */
    forceRefresh?: boolean;
}

/**
 * 场景回应检查结果。
 *
 * `usedExpressions` 始终由本地逐字匹配计算，作为可解释的辅助证据；
 * AI 可用时在同等事实基础上补充点评与更自然的回应。
 */
export interface RolePlayFeedbackVO {
    level: RetellLevel;
    /** AI 点评；本地回退时为空，由前端按等级渲染本地化提示。 */
    feedback: string;
    /** 更自然的英文回应；本地回退时为空。 */
    improved: string;
    /** 用户回应中实际出现的表达。 */
    usedExpressions: string[];
    source: LearningRecapSource;
    cached: boolean;
}
