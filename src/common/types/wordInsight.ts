/**
 * AI 词卡语境解读的结构化结果。
 */
export interface WordContextInsight {
    /** 该词在当前字幕句中的确切中文含义。 */
    meaning: string;
    /** 语境差异、搭配、语气或易混淆点；没有值得说明的内容时为空字符串。 */
    nuance: string;
    /** 本次结果由云端模型还是本地模型生成。 */
    source: 'cloud' | 'local';
    /** 是否直接命中进程内缓存。 */
    cached: boolean;
}

/**
 * 请求词卡语境解读的参数。
 */
export interface WordContextInsightParams {
    /** 用户点击的单词原文。 */
    word: string;
    /** 单词所在字幕整句，作为唯一语境依据。 */
    sentence: string;
    /** 当前词卡已有释义，作为 grounding；可以为空。 */
    definitions?: string[];
    /** 是否绕过缓存重新生成。 */
    forceRefresh?: boolean;
}

/**
 * 语境解读的可用性结果。
 *
 * 未配置 AI 或模型未就绪时返回 `unavailable`，前端据此展示克制的降级提示，
 * 词典本身的本地释义不受影响。
 */
export type WordContextInsightResponse =
    | { status: 'ok'; insight: WordContextInsight }
    | { status: 'unavailable'; reason: 'ai-disabled' | 'model-unavailable' };
