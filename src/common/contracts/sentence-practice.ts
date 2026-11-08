/**
 * 句子跟读/听写练习的契约：录音 → 本地 ASR → 词级对齐评分 → 持久化。
 */

/**
 * 练习模式。
 * - shadowing：跟读——播放原句音频,用户朗读录音,后端转写后与原句对齐评分;
 * - dictation：听写——播放原句音频,用户键入听到的内容,直接与原句对齐评分。
 */
export type SentencePracticeMode = 'shadowing' | 'dictation';

/**
 * 单词级对齐结果,驱动逐词反馈 chips。
 */
export interface SentencePracticeWordResult {
    /** 原句中期望的词(规范化后)。 */
    expected: string;
    /** 用户实际说/写出的词;missing 时为 null。 */
    heard: string | null;
    /**
     * 对齐状态:
     * - match  发音/拼写正确;
     * - sub    有出入但按编辑距离判定为同一目标词(如听岔的音、拼错的词);
     * - missing 原句的词没说出来/没写出来;
     * - extra  多说/多写了原句没有的词。
     */
    status: 'match' | 'sub' | 'missing' | 'extra';
    /** sub 状态下 0-1 的字符相似度,越接近 1 越接近正确。 */
    similarity?: number;
}

/**
 * 一次练习的评分结果(实时返回,同时落库)。
 */
export interface SentencePracticeResultVO {
    /** 0-100 整数分:(match + 0.5×sub) / 期望词数 × 100。 */
    score: number;
    /** 用户语音的转写文本;听写模式为 null(打字内容即比对源)。 */
    transcript: string | null;
    /** 按原句词序排列的对齐结果,extra 词追加在末尾。 */
    words: SentencePracticeWordResult[];
    /** 本次跟读录音的绝对路径,供前端回放自己的发音;听写/无录音时为 null。 */
    audioPath: string | null;
}

/**
 * 一条已持久化的练习记录。
 */
export interface SentencePracticeRecordVO {
    id: number;
    /** 字幕内容 hash(Sentence.fileHash),定位到具体视频。 */
    fileHash: string;
    /** 意群在字幕中的序号(Sentence.index)。 */
    sentenceIndex: number;
    mode: SentencePracticeMode;
    score: number;
    /** 语音转写文本或听写输入;shadowing 转写失败时为 null。 */
    transcript: string | null;
    /** 跟读录音的绝对路径;听写记录无音频为 null。 */
    audioPath: string | null;
    createdAt: string;
}

/**
 * practice/score-shadowing 的入参。
 */
export interface SentencePracticeShadowingParams {
    fileHash: string;
    sentenceIndex: number;
    /** MediaRecorder 采集的 webm/opus 音频字节。 */
    audio: Uint8Array;
    /** 用于对齐评分的原句文本(前端当前意群原文)。 */
    expectedText: string;
}

/**
 * practice/score-dictation 的入参。
 */
export interface SentencePracticeDictationParams {
    fileHash: string;
    sentenceIndex: number;
    /** 用户键入的听写内容。 */
    typedText: string;
    /** 用于对齐评分的原句文本。 */
    expectedText: string;
}
