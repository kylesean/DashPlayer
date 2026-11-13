import { isContentLemma } from '@/common/learning/contentWords';
import type { ProsodyShift } from '@/common/learning/prosodySignal';
import { cleanWord, isWordToken, splitWords } from '@/common/utils/subtitle/tokenize';

/**
 * 场景切分实际需要的字幕字段。
 *
 * 只声明真正参与判定的字段，而不是复用完整的 `Sentence`：切分不读译文、
 * 不读翻译分组，跨进程传输时也就不必把这些大字段带过来。
 */
export interface SceneSentence {
    /** 字幕内容哈希；同一份字幕的所有句子一致。 */
    fileHash: string;
    /** 句在字幕中的序号。 */
    index: number;
    /** 开始秒数。 */
    start: number;
    /** 结束秒数。 */
    end: number;
    /** 英文原文。 */
    text: string;
}

/**
 * 声纹分离得到的一个说话人区间。
 *
 * 由 sherpa-onnx 离线说话人分离产出，是「谁在说」的真实信号，而不是
 * 从文本推测。时间与字幕句同属媒体时间轴，可直接按区间重叠判定。
 */
export interface SpeakerInterval {
    /** 区间开始秒数。 */
    start: number;
    /** 区间结束秒数。 */
    end: number;
    /** 说话人标签；同一视频内稳定。 */
    speaker: string;
}

/** 场景边界类型。 */
export type SceneBoundaryKind =
    | 'time-gap'
    | 'topic-shift'
    | 'speaker-shift'
    | 'visual-shift'
    | 'prosody-shift';

/**
 * 场景切分算法版本。
 *
 * 阈值、信号或输出结构变化时递增：持久化索引按 `fileHash + 版本` 唯一，
 * 版本变了旧结果自然失效并重算，不会读到旧阈值的结果却以为是最新。
 *
 * v2：speaker-shift 可由真实声纹区间判定，置信度与文本启发式不同。
 * v3：新增 prosody-shift，语音韵律（语速/音量）可作为第五类边界信号。
 * v4：多信号共振提升置信度，并导出前端使用的说话人提示与场景分割筛选器。
 */
export const SCENE_SEGMENTATION_VERSION = 4;

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
    /**
     * 声纹分离区间；提供时用真实说话人变化替代问句/短回应的文本推测。
     *
     * 缺省（或空数组）时退回纯文本启发式：没有声纹能力的安装仍能得到
     * 场景提示，只是 speaker-shift 的置信度较低。
     */
    speakerIntervals?: readonly SpeakerInterval[];
    /**
     * 画面切换点（秒）；提供时把镜头切换也作为场景边界信号。
     *
     * 与声纹互补：声纹抓「谁在说」，画面抓「镜头去了哪里」，两者都不依赖
     * 字幕文本，能在没有对话的段落里给出边界。
     */
    visualShifts?: readonly number[];
    /**
     * 语音韵律突变点；提供时把语速或音量的骤变也作为场景边界信号。
     *
     * 与前两类信号正交：声纹抓「谁在说」，画面抓「镜头去了哪里」，韵律抓
     * 「说话方式变了」。听感上换人、切到旁白或进入争吵段落时，语速与音量
     * 常先于文本与画面发生变化。
     */
    prosodyShifts?: readonly ProsodyShift[];
}

const DEFAULT_TIME_GAP_SEC = 2.5;
const DEFAULT_TOPIC_SHIFT_THRESHOLD = 0.02;
const DEFAULT_WINDOW_SIZE = 3;
const QUESTION_END = /[?？]\s*$/u;
const SHORT_REPLY = /^(?:yes|no|okay|ok|sure|right|well|oh|wow|hey|hi|hello|thanks|thank you|sorry|please)[\s,.!?]*$/iu;

/**
 * 取与某句时间区间重叠最多的说话人标签。
 *
 * 用重叠时长而不是「句首落在哪个区间」：一句可能横跨换人点，按重叠最多
 * 归给主要说话人比按起点更稳定，也避免边界抖动造成的假换人。
 *
 * @param intervals 声纹区间（按开始时间升序）。
 * @param start 句开始秒数。
 * @param end 句结束秒数。
 * @returns 重叠最多的说话人标签；无重叠时为 null。
 */
const dominantSpeaker = (
    intervals: readonly SpeakerInterval[],
    start: number,
    end: number,
): string | null => {
    let best: string | null = null;
    let bestOverlap = 0;
    for (const interval of intervals) {
        const overlap = Math.min(end, interval.end) - Math.max(start, interval.start);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            best = interval.speaker;
        }
    }
    return best;
};

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

const unionLemmas = (sentences: readonly SceneSentence[]): Set<string> => {
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
 * 基础判定只用字幕时间与文本做确定性启发式：
 * - 明显的静默间隔；
 * - 前后窗口内容词几乎不重合；
 * - 短回应紧跟在问句之后（推测说话人切换）。
 *
 * 声纹区间、画面切换点与语音韵律作为可选信号由调用方传入：三者都来自
 * 对视频本体的分析，缺失时自动退回纯字幕启发式。即便如此也不声称是
 * 精确的场景/说话人识别。
 *
 * @param sentences 按 index 升序的字幕句。
 * @param options 阈值覆盖。
 * @returns 场景边界列表；没有边界时为空数组。
 */
export const segmentScenes = (
    sentences: readonly SceneSentence[],
    options: SceneSegmentationOptions = {},
): SceneBoundary[] => {
    if (sentences.length < 2) {
        return [];
    }
    const timeGapSec = options.timeGapSec ?? DEFAULT_TIME_GAP_SEC;
    const topicShiftThreshold = options.topicShiftThreshold ?? DEFAULT_TOPIC_SHIFT_THRESHOLD;
    const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE);
    const speakerIntervals = options.speakerIntervals ?? [];
    const visualShifts = options.visualShifts ?? [];
    // 韵律突变按句序号索引：与画面切换不同，它天然对齐到具体某一句，
    // 不需要按时间窗匹配。
    const prosodyByIndex = new Map<number, ProsodyShift>();
    for (const shift of options.prosodyShifts ?? []) {
        if (!prosodyByIndex.has(shift.sentenceIndex)) {
            prosodyByIndex.set(shift.sentenceIndex, shift);
        }
    }
    // 画面切换点按时间升序，句级判定时用二分查找最近的点，避免每句线性扫描。
    const sortedVisualShifts = [...visualShifts].sort((left, right) => left - right);

    const boundaries: SceneBoundary[] = [];
    // 句子按时间升序，画面切换点也升序：用游标单调前进，整体 O(n + m)。
    let visualCursor = 0;
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

        if (speakerIntervals.length > 0) {
            // 有真实声纹时只认声纹：文本推测在多人访谈里误报率太高，
            // 两路信号同时存在会让「可能换了说话人」变成噪声。
            const previousSpeaker = dominantSpeaker(speakerIntervals, previous.start, previous.end);
            const currentSpeaker = dominantSpeaker(speakerIntervals, current.start, current.end);
            if (previousSpeaker && currentSpeaker && previousSpeaker !== currentSpeaker) {
                kinds.push('speaker-shift');
                confidence = Math.max(confidence, 0.85);
            }
        } else if (
            QUESTION_END.test(previous.text)
            && SHORT_REPLY.test(current.text.trim())
        ) {
            kinds.push('speaker-shift');
            confidence = Math.max(confidence, 0.45);
        }

        // 画面切换点落在「上一句结束 → 当前句开始」附近才算这一句的边界：
        // 切镜可能发生在句间停顿里，也可能正好压在句首。
        while (visualCursor < sortedVisualShifts.length && sortedVisualShifts[visualCursor] < previous.end - 0.5) {
            visualCursor += 1;
        }
        const shift = sortedVisualShifts[visualCursor];
        if (shift !== undefined && shift <= current.start + 0.5) {
            kinds.push('visual-shift');
            confidence = Math.max(confidence, 0.6);
            // 一个切换点只归属一句：消耗掉它，避免短句被连续标记两次。
            visualCursor += 1;
        }

        const prosody = prosodyByIndex.get(current.index);
        if (prosody) {
            kinds.push('prosody-shift');
            // 语速变化比音量变化更可靠：配乐与音效也会推高音量，却不会
            // 改变词速，因此两者给不同置信度。
            confidence = Math.max(confidence, prosody.reason === 'rate' ? 0.7 : 0.6);
        }

        if (kinds.length === 0) {
            continue;
        }
        // 多路信号在同一句共振时（例如换场静默 + 话题转换/镜头切换），显著提升置信度。
        if (kinds.length >= 2) {
            confidence = Math.min(1, confidence + 0.15);
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

const MIN_SPEAKER_CUE_CONFIDENCE = 0.7;
const MIN_SCENE_DIVIDER_CONFIDENCE = 0.65;
const DEFAULT_SCENE_COOLDOWN_SEC = 20;
const DEFAULT_SCENE_COOLDOWN_SENTENCES = 4;

/**
 * 判断一条边界是否值得在主字幕上方提示「换人说话」。
 *
 * 仅保留高置信度换人信号（真实声纹分离，或文本推测叠加了其它边界信号），
 * 避免无声纹时的纯文本短回应启发式在主字幕区产生误报。
 */
export const isHighConfidenceSpeakerShift = (boundary: SceneBoundary): boolean => (
    boundary.kinds.includes('speaker-shift') && boundary.confidence >= MIN_SPEAKER_CUE_CONFIDENCE
);

/**
 * 从原始边界中筛选出适合在右侧字幕栏展示的「场景 / 话题分割线」。
 *
 * 过滤原则：
 * 1. 单纯的语速/音量波动（prosody-shift）或单次切镜（visual-shift）噪音过高，
 *    只作为多信号共振的加权证据，不单独成章；
 * 2. 需要达到较高置信度（>= 0.65，如长停顿或两路以上信号共振）；
 * 3. 相邻分割线之间保持最小冷却间隔（默认 20s 且至少间隔 4 句），防止碎片化。
 */
export const selectSceneDividers = (
    boundaries: readonly SceneBoundary[],
    options: {
        minConfidence?: number;
        cooldownSec?: number;
        cooldownSentences?: number;
    } = {},
): SceneBoundary[] => {
    const minConfidence = options.minConfidence ?? MIN_SCENE_DIVIDER_CONFIDENCE;
    const cooldownSec = options.cooldownSec ?? DEFAULT_SCENE_COOLDOWN_SEC;
    const cooldownSentences = options.cooldownSentences ?? DEFAULT_SCENE_COOLDOWN_SENTENCES;

    const dividers: SceneBoundary[] = [];
    let lastDivider: SceneBoundary | null = null;

    for (const boundary of boundaries) {
        const hasStructuralSignal = boundary.kinds.includes('time-gap') || boundary.kinds.includes('topic-shift');
        const hasMultiSignal = boundary.kinds.length >= 2;
        if (!hasStructuralSignal && !hasMultiSignal) {
            continue;
        }
        if (boundary.confidence < minConfidence) {
            continue;
        }
        if (lastDivider) {
            const elapsedSec = boundary.atSec - lastDivider.atSec;
            const sentenceDelta = boundary.sentenceIndex - lastDivider.sentenceIndex;
            if (elapsedSec < cooldownSec || sentenceDelta < cooldownSentences) {
                continue;
            }
        }
        dividers.push(boundary);
        lastDivider = boundary;
    }

    return dividers;
};
