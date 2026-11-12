import type { LearningSessionSummaryVO } from '@/common/types/learningSession';
import type { SentencePracticeRhythmFeedback } from '@/common/contracts/sentence-practice';

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
    /** 来源视频，仅用于把本次复述归到对应视频下。 */
    videoId?: string;
    /** 来源字幕 hash，仅用于复盘弹窗读取「上次结果」。 */
    fileHash?: string;
    /** 原句在字幕中的序号；无法定位时省略。 */
    sentenceIndex?: number;
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
    /** 来源视频，仅用于把本次回应归到对应视频下。 */
    videoId?: string;
    /** 来源字幕 hash，仅用于复盘弹窗读取「上次结果」。 */
    fileHash?: string;
    /** 开场白在字幕中的序号；无法定位时省略。 */
    sentenceIndex?: number;
}

/**
 * 产出型练习模式。
 */
export type ProductionPracticeMode = 'retell' | 'roleplay';

/**
 * 复盘弹窗读取「上次结果」的参数。
 */
export interface ProductionPracticeListParams {
    videoId?: string;
    fileHash?: string;
    /** 返回条数上限，默认 10。 */
    limit?: number;
}

/**
 * 一次产出型练习记录。
 */
export interface ProductionPracticeRecordVO {
    id: number;
    mode: ProductionPracticeMode;
    /** great | good | retry */
    level: RetellLevel;
    /** 复述原句或角色扮演开场白。 */
    sentenceText: string;
    /** 用户当时的回答。 */
    responseText: string;
    feedback: string | null;
    improved: string | null;
    createdAt: string;
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

/**
 * 多轮场景对话中已完成的一轮。
 *
 * 对方台词永远来自真实字幕行；学习者回应是用户自己写的文本。
 */
export interface RolePlayTurnVO {
    /** 从 1 开始的轮次序号。 */
    turn: number;
    /** 对方这一轮的台词（真实字幕）。 */
    partnerLine: string;
    /** 对方台词在字幕中的序号；无法定位时为 null。 */
    partnerIndex: number | null;
    /** 学习者这一轮的回应。 */
    response: string;
    level: RetellLevel;
    feedback: string;
    improved: string;
    usedExpressions: string[];
    source: LearningRecapSource;
}

/**
 * 提交一轮多轮场景对话的参数。
 */
export interface RolePlayTurnParams {
    /** 会话键；由前端按视频与开场白派生，重开弹窗后仍能续聊。 */
    sessionKey: string;
    /** 场景说明，仅作为点评上下文。 */
    scenario?: string;
    /** 对方这一轮的台词，必须能在字幕里逐字定位。 */
    partnerLine: string;
    /** 对方台词在字幕中的序号；前端从真实字幕取行时一并传入。 */
    partnerIndex?: number;
    /** 学习者这一轮的回应。 */
    response: string;
    /** 希望用户用上的表达。 */
    targetExpressions?: string[];
    /** 本会话已完成的轮次，供点评理解对话进行到哪一步。 */
    previousTurns?: Array<{ partnerLine: string; response: string }>;
    locale?: 'zh-CN' | 'en-US';
    /** 是否绕过缓存重新检查。 */
    forceRefresh?: boolean;
    videoId?: string;
    fileHash?: string;
}

/**
 * 一轮多轮场景对话的检查结果。
 *
 * 下一句对方台词不在这里返回：它由前端按真实字幕确定性挑选，
 * 后端只负责点评与轮次记账，避免同一套选行逻辑出现两份实现。
 */
export interface RolePlayTurnResultVO extends RolePlayFeedbackVO {
    /** 这一轮在会话中的序号，从 1 开始。 */
    turn: number;
    /** 本轮对方台词的字幕序号；无法定位时为 null。 */
    partnerIndex: number | null;
}

/**
 * 读取某个会话已有轮次的参数。
 */
export interface RolePlaySessionParams {
    sessionKey: string;
    fileHash?: string;
    videoId?: string;
}

/**
 * 一次多轮场景对话的状态。
 *
 * 只恢复已发生的轮次；下一句台词由前端按真实字幕挑选，服务端不缓存字幕。
 */
export interface RolePlaySessionVO {
    sessionKey: string;
    turns: RolePlayTurnVO[];
}

/**
 * 语音复述参数。
 *
 * 与书面复述共用同一套评分与掌握度链路，区别只是答案来自本地 ASR 转写。
 */
export interface SpokenRetellParams {
    /** 原字幕句。 */
    original: string;
    /** MediaRecorder 采集的录音字节。 */
    audio: Uint8Array;
    /** 原句音频时长（秒），用于语速对比；未知时省略。 */
    referenceDurationSec?: number;
    locale?: 'zh-CN' | 'en-US';
    videoId?: string;
    fileHash?: string;
    sentenceIndex?: number;
}

/**
 * 语音复述结果。
 *
 * 在书面复述结果之上补充转写文本与节奏信号，让用户看到「系统听到的是什么」。
 */
export interface SpokenRetellVO extends RetellEvaluationVO {
    /** 本地 ASR 转写文本；这是实际参与评分的答案。 */
    transcript: string;
    /** 节奏与重读信号；录音无法分析时为 null。 */
    rhythm: SentencePracticeRhythmFeedback | null;
}
