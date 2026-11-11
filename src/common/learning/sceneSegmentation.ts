import type { Sentence } from '@/common/types/SentenceC';
import { isContentLemma } from '@/common/learning/contentWords';
import { cleanWord, isWordToken, splitWords } from '@/common/utils/subtitle/tokenize';

/** 场景边界类型。 */
export type SceneBoundaryKind = 'time-gap' | 'topic-shift' | 'speaker-shift';

/** 一个本地推测的场景边界。 */
export interface SceneBoundary {
    /** 边界之后的第一句在字幕中的 index。 */
    sentenceIndex: number;
    /** 边界发生在该秒数。 */
    atSec: number;
    /** 触发原因，按置信度从高到低排列。 */
    kinds: SceneBoundaryKind[];
    /** 0-1 的本地置信度；只表示信号强弱，不是模型判断。 */
    confidence: number;
}

/** 场景切分参数。 */
export interface SceneSegmentationOptions {
    /** 相邻句间隔超过该秒数视为换场。 */
    timeGapSec?: number;
    /** 相邻窗口内容词 Jaccard 相似度低于该值视为话题转换。 */
    topicShiftThreshold?: number;
    /** 每侧用于比较的句数。 */
    windowSize?: number;
}

const DEFAULT_TIME_GAP_SEC = 2.5;
const DEFAULT_TOPIC_SHIFT_THRESHOLD = 0.02;
const DEFAULT_WINDOW_SIZE = 3;
const QUESTION_END = /[?？]\s*$/u;
const SHORT_REPLY = /^(?:yes|no|okay|ok|sure|right|well|oh|wow|hey|hi|hello|thanks|thank you|sorry|please)[\s,.!?]*$/iu;

/**
 * 提取一句字幕的内容词集合，用于本地话题相似度。
 */
const contentLemmasOf = (text: string): Set<string> => {
    const lemmas = new Set<string>();
    for (const token of splitWords(text)) {
        if (!isWordToken(token)) continue;
        const lemma = cleanWord(token).toLowerCase();
        if (lemma && isContentLemma(lemma)) {
            lemmas.add(lemma);
        }
    }
    return lemmas;
};

const jaccard = (left: Set<string>, right: Set<string>): number => {
    if (left.size === 0 || right.size === 0) {
        return 0;
    }
    let intersection = 0;
    for (const value of left) {
        if (right.has(value)) {
            intersection += 1;
        }
    }
    return intersection / (left.size + right.size - intersection);
};

const unionLemmas = (sentences: Sentence[]): Set<string> => {
    const result = new Set<string>();
    for (const sentence of sentences) {
        for (const lemma of contentLemmasOf(sentence.text)) {
            result.add(lemma);
        }
    }
    return result;
};

/**
 * 本地场景切分。
 *
 * 只用字幕时间与文本做确定性启发式：
 * - 明显的静默间隔；
 * - 前后窗口内容词几乎不重合；
 * - 短回应紧跟在问句之后（推测说话人切换）。
 *
 * 不读取画面、不做声纹分离，也不声称是精确的场景/说话人识别。
 *
 * @param sentences 按 index 升序的字幕句。
 * @param options 阈值覆盖。
 * @returns 场景边界列表；没有边界时为空数组。
 */
export const segmentScenes = (
    sentences: Sentence[],
    options: SceneSegmentationOptions = {},
): SceneBoundary[] => {
    if (sentences.length < 2) {
        return [];
    }
    const timeGapSec = options.timeGapSec ?? DEFAULT_TIME_GAP_SEC;
    const topicShiftThreshold = options.topicShiftThreshold ?? DEFAULT_TOPIC_SHIFT_THRESHOLD;
    const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);

    const boundaries: SceneBoundary[] = [];
    for (let i = 1; i < sentences.length; i += 1) {
        const previous = sentences[i - 1];
        const current = sentences[i];
        const kinds: SceneBoundaryKind[] = [];
        let confidence = 0;

        const gap = current.start - previous.end;
        if (gap >= timeGapSec) {
            kinds.push('time-gap');
            confidence = Math.max(confidence, Math.min(1, 0.55 + (gap - timeGapSec) / 10));
        }

        const leftWindow = sentences.slice(Math.max(0, i - windowSize), i);
        const rightWindow = sentences.slice(i, Math.min(sentences.length, i + windowSize));
        const leftLemmas = unionLemmas(leftWindow);
        const rightLemmas = unionLemmas(rightWindow);
        const similarity = jaccard(leftLemmas, rightLemmas);
        // 词太少时 Jaccard 天然接近 0，容易把正常换句误判成换场；要求两侧都有足够内容词。
        if (
            leftLemmas.size >= 3
            && rightLemmas.size >= 3
            && similarity <= topicShiftThreshold
        ) {
            kinds.push('topic-shift');
            confidence = Math.max(confidence, 0.45 + Math.min(0.25, leftLemmas.size / 40));
        }

        if (
            QUESTION_END.test(previous.text)
            && SHORT_REPLY.test(current.text.trim())
        ) {
            kinds.push('speaker-shift');
            confidence = Math.max(confidence, 0.45);
        }

        if (kinds.length === 0) {
            continue;
        }
        boundaries.push({
            sentenceIndex: current.index,
            atSec: Number(current.start.toFixed(2)),
            kinds,
            confidence: Number(Math.min(1, confidence).toFixed(2)),
        });
    }
    return boundaries;
};
