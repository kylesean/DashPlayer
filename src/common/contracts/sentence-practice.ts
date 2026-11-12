/**
 * 句子跟读/听写练习的契约：录音 → 本地 ASR → 词级对齐评分 → 持久化。
 */

import type {
    ReferenceSyllable,
    SyllableCountVerdict,
} from '@/common/utils/practice/syllableFeedback';

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
 * 单个词的节奏信号（只描述时长与相对重读，不评价发音是否正确）。
 */
export interface SentencePracticeWordRhythm {
    /** 规范化后的原句词。 */
    word: string;
    /** 用户在录音中实际说出的时长（秒）；该词缺失时为 null。 */
    durationSec: number | null;
    /** 0-1 的录音能量峰值，仅用于同一段录音内的相对比较。 */
    emphasis: number | null;
    /** 相对同句其他内容词是否明显更重；弱读/虚词不参与重读判定。 */
    stressed: boolean;
    /** 词典音标；词不在词典里时为 null。只展示参考结构，不判定音素对错。 */
    phonetic?: string | null;
    /** 由 IPA 切分出的参考音节；没有音标时为空数组。 */
    syllables?: ReferenceSyllable[];
    /** 参考主重音所在音节序号；没有音标或没有重音标记时为 null。 */
    stressIndex?: number | null;
    /** 用户录音里的重读音节序号；无法可靠判断时为 null。 */
    spokenStressIndex?: number | null;
    /** 重音位置是否与参考一致；任一侧未知时为 null。 */
    stressAligned?: boolean | null;
}

/**
 * 跟读的节奏与重读分布。
 *
 * 这是基于本地 ASR 时间轴与录音能量的确定性信号，不是发音准确度评分。
 */
export interface SentencePracticeRhythmFeedback {
    /** 用户说话时长（秒）。 */
    speechDurationSec: number;
    /** 每词平均时长（秒）；没有可用词时为空。 */
    averageWordDurationSec: number | null;
    /** 与原句音频时长的比值；>1 表示更慢。原句时长未知时为 null。 */
    paceRatio: number | null;
    /** 语速评价：偏快 / 合适 / 偏慢；无法判断时为 null。 */
    pace: 'fast' | 'steady' | 'slow' | null;
    /** 逐词节奏，按原句词序；无法对齐的词也保留，时长为 null。 */
    words: SentencePracticeWordRhythm[];
    /** 重读位置与平均语速的简短结论代码，由前端本地化。 */
    notes: Array<'pace-fast' | 'pace-slow' | 'flat-stress' | 'syllables-fewer' | 'syllables-more' | 'stress-shifted'>;
    /**
     * 音节数对比结论。
     *
     * 用户音节数由说话时长估算，不是逐音节识别；只在差异明显时给出结论。
     */
    syllables?: SyllableCountVerdict;
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
    /** 跟读节奏与重读分布;听写、无录音或分析失败时为 null。 */
    rhythm?: SentencePracticeRhythmFeedback | null;
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
    /** 记录是否在意群重切分行上产生;与序号共同构成查询键,隔离开关切换后的序号重排。 */
    resegmented: boolean;
    mode: SentencePracticeMode;
    score: number;
    /** 语音转写文本或听写输入;shadowing 转写失败时为 null。 */
    transcript: string | null;
    /** 跟读录音的绝对路径;听写记录无音频为 null。 */
    audioPath: string | null;
    createdAt: string;
}

/**
 * 整片按意群聚合的练习摘要,驱动练习进度条与薄弱句筛选。
 */
export interface SentencePracticeSummaryVO {
    sentenceIndex: number;
    /** 该意群在跟读与听写中的历史最高分(0-100)。 */
    bestScore: number;
    /** 历史总练习次数。 */
    attemptCount: number;
    /** 最近一次练习模式。 */
    lastMode: SentencePracticeMode;
    /** 最近一次练习时间戳。 */
    lastPracticedAt: string;
}

/**
 * practice/score-shadowing 的入参。
 */
export interface SentencePracticeShadowingParams {
    fileHash: string;
    sentenceIndex: number;
    /** 记录是否在意群重切分行上产生(与 Sentence 加载时的 resegmented 标志一致)。 */
    resegmented: boolean;
    /** MediaRecorder 采集的 webm/opus 音频字节。 */
    audio: Uint8Array;
    /** 用于对齐评分的原句文本(前端当前意群原文)。 */
    expectedText: string;
    /** 原句音频参考时长（秒），用于语速对比；未知时省略。 */
    referenceDurationSec?: number;
}

/**
 * practice/score-dictation 的入参。
 */
export interface SentencePracticeDictationParams {
    fileHash: string;
    sentenceIndex: number;
    /** 记录是否在意群重切分行上产生(与 Sentence 加载时的 resegmented 标志一致)。 */
    resegmented: boolean;
    /** 用户键入的听写内容。 */
    typedText: string;
    /** 用于对齐评分的原句文本。 */
    expectedText: string;
}
