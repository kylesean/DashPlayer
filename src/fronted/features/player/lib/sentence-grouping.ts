import type { Sentence } from '@/common/types/SentenceC';

/**
 * 意群块：若干条连续字幕行归并出的完整意群。
 *
 * 整句模式下它取代单条字幕行，成为精听导航、单句循环与自动暂停的最小单位；
 * 渲染层按块展示全部行并高亮当前行。
 */
export interface SentenceBlock {
    /** 块内字幕行（按 index 升序）。 */
    sentences: Sentence[];
    /** 块起始时间（秒，取首行原始 start）。 */
    start: number;
    /** 块结束时间（秒，取末行原始 end）。 */
    end: number;
    /** 块内累计英文字符数（含行间空格），用于防止无标点字幕归并出巨块。 */
    charCount: number;
    /** 块代表句（首行），供导航定位与 seek 使用。 */
    repr: Sentence;
}

/**
 * 句末标点：行文本以此收尾即视为完整意群结束。
 * 允许紧跟收尾引号/括号（如 `."`、`?")`）；省略号（… 或 ...）同样算收束。
 */
const TERMINAL_END_PATTERN = /[.!?…]["'”』」)\]]?$/;

/** 行间隔小于该值（秒）才归入同一意群；说话人明显停顿视为天然边界。 */
const MAX_GAP_SECONDS = 0.8;

/**
 * 单个意群的英文字符数上限。
 * YouTube 自动字幕可能整段没有句末标点，没有上限会把几十行归并成一个巨块。
 */
const MAX_BLOCK_CHARS = 220;

/**
 * 判断行文本是否以句末标点收束。
 *
 * @param text 行文本（英文原文）。
 * @returns 以句末标点结尾时返回 `true`。
 */
const endsWithTerminalPunctuation = (text: string): boolean => {
    const trimmed = text.trimEnd();
    return trimmed.length > 0 && TERMINAL_END_PATTERN.test(trimmed);
};

/**
 * 把字幕行归并成完整意群块。
 *
 * 归并条件（对「当前块末行 → 下一行」同时满足）：末行不以句末标点收束、
 * 两行间隔小于 {@link MAX_GAP_SECONDS}、并入后块内字符数不超过
 * {@link MAX_BLOCK_CHARS}；任一不满足即封块另起。时间上允许行区间重叠
 * （间隔为负同样视为连续）。
 *
 * @param sentences 字幕行数组；应已按 index 升序。
 * @returns 按输入顺序排列的意群块；单行视频每行即一块。
 */
export const groupSentencesIntoBlocks = (sentences: Sentence[]): SentenceBlock[] => {
    const blocks: SentenceBlock[] = [];
    let current: SentenceBlock | null = null;
    for (const sentence of sentences) {
        const canMerge = current !== null
            && !endsWithTerminalPunctuation(current.sentences[current.sentences.length - 1].text)
            && sentence.start - current.end < MAX_GAP_SECONDS
            && current.charCount + sentence.text.length <= MAX_BLOCK_CHARS;
        if (current !== null && canMerge) {
            current.sentences.push(sentence);
            current.end = sentence.end;
            current.charCount += sentence.text.length;
        } else {
            current = {
                sentences: [sentence],
                start: sentence.start,
                end: sentence.end,
                charCount: sentence.text.length,
                repr: sentence,
            };
            blocks.push(current);
        }
    }
    return blocks;
};

/**
 * 查找句子所属的意群块。
 *
 * @param blocks 归并结果。
 * @param sentence 目标句子；null 时直接返回 null。
 * @returns 所属块；找不到（如切视频后的旧引用）返回 `null`。
 */
export const findSentenceBlock = (
    blocks: SentenceBlock[],
    sentence: Sentence | null,
): SentenceBlock | null => {
    if (!sentence) {
        return null;
    }
    return blocks.find((block) => block.sentences.some((item) => item.key === sentence.key)) ?? null;
};
