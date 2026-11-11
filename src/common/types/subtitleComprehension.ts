import type { WordStatus } from '@/common/types/vocabulary';

/**
 * 句子理解度区间。
 *
 * high 表示用户大概率能直接听懂，可以弱化中文；medium 表示保留但降低视觉权重；
 * low 表示继续完整展示中文辅助。
 */
export const COMPREHENSION_BANDS = ['high', 'medium', 'low'] as const;
export type ComprehensionBand = (typeof COMPREHENSION_BANDS)[number];

/**
 * 本地词典给出的词汇难度档位。
 */
export type ComprehensionDifficulty = 'basic' | 'common' | 'exam' | 'advanced' | 'unknown';

/**
 * 参与理解度估算的一个内容词。
 */
export interface ComprehensionWordInput {
    lemma: string;
    difficulty: ComprehensionDifficulty;
    userStatus?: WordStatus;
    mastery?: number;
}

/**
 * 理解度估算输入。
 */
export interface ComprehensionEstimateInput {
    words: ComprehensionWordInput[];
    wordCount: number;
    clauseCount: number;
    longWordCount: number;
}

/**
 * 理解度估算结果。
 */
export interface ComprehensionEstimate {
    score: number;
    band: ComprehensionBand;
    knownContentRatio: number;
    syntaxComplexity: number;
    contentWords: number;
    unknownWords: string[];
}

/**
 * 查询句子理解度的参数。
 */
export interface SubtitleComprehensionParams {
    text: string;
    fileHash?: string;
    sentenceIndex?: number;
}

/**
 * 句子理解度快照。
 */
export interface SubtitleComprehensionVO extends ComprehensionEstimate {
    fileHash?: string;
    sentenceIndex?: number;
}
