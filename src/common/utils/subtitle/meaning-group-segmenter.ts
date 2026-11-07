import type { SrtLine } from './types';

/**
 * 意群重切分：把滚动式碎片字幕（YouTube 自动字幕的典型形态——cue 时间轴重叠、
 * 句子被拦腰切断、常无句末标点）重切分成"完整意群"级别的字幕行。
 *
 * 切分后的每一行都是一个完整的意群，可直接作为翻译单元（模型拿到完整句子，
 * 不再对 `you are` 这类半截碎片瞎译）与精听循环单元（单句循环不再停在半个意群）。
 */

/** 句末标点：允许其后紧跟收尾引号/括号（如 `."`、`?"`）；省略号同样算收束。 */
const TERMINAL_PATTERN = /[.!?…]+["'”』」)\]]?/g;

/** 说话人切换标记：YouTube 自动字幕用 `>>` 表示换人，视为强制句边界。 */
const SPEAKER_MARK_PATTERN = /^\s*(>>\s*)+/;

/** cue 间隔达到该值（秒）视为说话停顿，强制封句。 */
const GAP_BREAK_SECONDS = 0.8;

/** 句缓冲字符数达到该值仍无句末标点时，在 cue 边界强制封句，防止无标点段落归并出巨块。 */
const MAX_BUFFER_CHARS = 250;

/** 切分后子区间的最小时长（秒）：低于它的相邻子区间会被延展，保证 createSrtLine 的严格递增校验。 */
const MIN_SEGMENT_SECONDS = 0.2;

/** cue 内一段文本的时间插值条目：字符偏移区间 → 该段应占的起止时间。 */
interface TextPiece {
    /** 该段文本（已 trim 的展示文本）。 */
    text: string;
    /** 段起点在 cue 拼接文本中的字符偏移。 */
    startOffset: number;
    /** 段终点在 cue 拼接文本中的字符偏移（不含）。 */
    endOffset: number;
    /** 段起点时间（秒）。 */
    start: number;
    /** 段终点时间（秒）。 */
    end: number;
}

/**
 * 判断一段文本是否以句末标点收束（复用前端整句模式的判定口径，允许收尾引号）。
 */
const endsWithTerminal = (text: string): boolean => {
    const trimmed = text.trimEnd();
    return /[.!?…]["'”』」)\]]?$/.test(trimmed);
};

/**
 * 找出文本中所有句末标点的结束偏移（不含）。
 *
 * @param text 待扫描文本。
 * @returns 每个句末标点串的结束偏移，升序。
 */
const findTerminalOffsets = (text: string): number[] => {
    TERMINAL_PATTERN.lastIndex = 0;
    const offsets: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = TERMINAL_PATTERN.exec(text)) !== null) {
        offsets.push(match.index + match[0].length);
        if (match[0].length === 0) {
            TERMINAL_PATTERN.lastIndex += 1;
        }
    }
    return offsets;
};

/**
 * 把一条 cue 的文本按"句边界 + `>>` 说话人标记"切成若干段，并按字符占比插值时间。
 *
 * cue 的原始区间为 [start, end]；若段内时间插值结果过短（低于
 * {@link MIN_SEGMENT_SECONDS}），向相邻段借时长兜底，保证所有子区间严格递增。
 *
 * @param line 待切分的字幕行。
 * @returns 切分出的文本片段时间轴（至少一段）。
 */
const splitLineIntoPieces = (line: SrtLine): TextPiece[] => {
    const text = line.contentEn;
    const duration = line.end - line.start;

    // 1. 先按句末标点找全部切点，再按 `>>` 说话人标记补充切点。
    const breakpoints = new Set<number>(findTerminalOffsets(text));
    const speakerMark = SPEAKER_MARK_PATTERN.exec(text);
    if (speakerMark && speakerMark[0].length < text.length) {
        breakpoints.add(speakerMark[0].length);
    }
    const sortedBreakpoints = [...breakpoints].filter((offset) => offset > 0 && offset < text.length).sort((a, b) => a - b);

    if (sortedBreakpoints.length === 0) {
        return [{ text: text.trim(), startOffset: 0, endOffset: text.length, start: line.start, end: line.end }];
    }

    // 2. 按切点分段，时间按字符占比线性插值。
    const bounds = [0, ...sortedBreakpoints, text.length];
    const rawPieces: TextPiece[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        const startOffset = bounds[i];
        const endOffset = bounds[i + 1];
        const pieceText = text.slice(startOffset, endOffset);
        if (!pieceText.trim()) continue;
        const start = line.start + duration * (startOffset / text.length);
        const end = line.start + duration * (endOffset / text.length);
        rawPieces.push({ text: pieceText.trim(), startOffset, endOffset, start, end });
    }
    if (rawPieces.length === 0) {
        return [{ text: text.trim(), startOffset: 0, endOffset: text.length, start: line.start, end: line.end }];
    }

    // 3. 剥离段首的说话人标记（学习场景是噪音，标记本身已充当句边界）。
    for (const piece of rawPieces) {
        piece.text = piece.text.replace(SPEAKER_MARK_PATTERN, '');
    }

    // 4. 兜底过短子区间：每段至少 MIN_SEGMENT_SECONDS，从相邻段借时长，
    //    保证时间轴严格递增（createSrtLine 会在 end <= start 时抛错）。
    for (let i = 0; i < rawPieces.length; i++) {
        const piece = rawPieces[i];
        if (piece.end - piece.start >= MIN_SEGMENT_SECONDS) continue;
        const needed = MIN_SEGMENT_SECONDS - (piece.end - piece.start);
        const next = rawPieces[i + 1];
        const prev = rawPieces[i - 1];
        if (next && next.end - next.start > MIN_SEGMENT_SECONDS) {
            piece.end = Math.min(piece.end + needed, next.end - MIN_SEGMENT_SECONDS);
        } else if (prev && prev.end - prev.start > MIN_SEGMENT_SECONDS) {
            piece.start = Math.max(piece.start - needed, prev.start + MIN_SEGMENT_SECONDS);
        }
    }
    return rawPieces.filter((piece) => piece.text.length > 0);
};

/**
 * 把碎片字幕行重切分成完整意群行。
 *
 * 规则：
 * 1. 逐行切成文本片段时间轴（句末标点 / `>>` 说话人标记处切分，时间按字符占比插值）；
 * 2. 相邻片段若无句末标点收束且间隔小于 0.8 秒，归并进同一意群；
 * 3. 缓冲字符数超过上限仍无标点时在片段边界强制封句；
 * 4. 双语字幕（任一行含中文）不处理，原样返回——人工对齐的双语文件重切分会错位。
 *
 * @param lines 解析产出的字幕行数组（应按时间升序）。
 * @returns 重切分后的字幕行（index 从 1 重新编号）；无需处理时原样返回。
 */
export const resegmentIntoMeaningGroups = (lines: SrtLine[]): SrtLine[] => {
    if (lines.length === 0) {
        return lines;
    }
    if (lines.some((line) => line.contentZh.trim().length > 0)) {
        return lines;
    }

    /** 意群缓冲：已归并的文本片段时间轴。 */
    interface BufferPiece {
        text: string;
        start: number;
        end: number;
    }
    const buffers: BufferPiece[] = [];
    let buffer: BufferPiece | null = null;
    let bufferChars = 0;

    const closeBuffer = () => {
        if (buffer && buffer.text.trim()) {
            buffers.push(buffer);
        }
        buffer = null;
        bufferChars = 0;
    };

    for (const line of lines) {
        for (const piece of splitLineIntoPieces(line)) {
            // 封块条件：并入后超出上限（而非当前已达到），否则恰好达标的块永远无法再并入。
            const startsNewGroup = buffer === null
                || (buffer.text.trim().length > 0 && endsWithTerminal(buffer.text))
                || piece.start - buffer.end >= GAP_BREAK_SECONDS
                || bufferChars + piece.text.length > MAX_BUFFER_CHARS;
            if (startsNewGroup || buffer === null) {
                closeBuffer();
                buffer = { text: piece.text, start: piece.start, end: piece.end };
                bufferChars = piece.text.length;
            } else {
                buffer.text = `${buffer.text} ${piece.text}`.trim();
                buffer.end = piece.end;
                bufferChars += piece.text.length;
            }
        }
    }
    closeBuffer();

    return buffers.map((item, index) => ({
        index: index + 1,
        start: item.start,
        end: item.end,
        contentEn: item.text,
        contentZh: '',
    }));
};
