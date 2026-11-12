import { isContentLemma } from '@/common/learning/contentWords';

/**
 * 多轮场景对话的一行真实字幕。
 *
 * 只保留对话推进需要的最小字段，避免把译文与分组结构传进纯函数。
 */
export interface RolePlaySubtitleLine {
    /** 字幕中的序号，用于稳定定位与回写。 */
    index: number;
    /** 英文原文。 */
    text: string;
}

/** 一句台词被选为「对方下一句」时要求的最少内容词数。 */
const MIN_PARTNER_CONTENT_WORDS = 2;
/** 单句台词的长度上限；过长的一行不适合做口语接话。 */
const MAX_PARTNER_CHARS = 160;
/** 允许向后搜索的字幕行数上限，避免长视频里搜索成本无界。 */
const MAX_LOOKAHEAD_LINES = 40;

/**
 * 把字幕原文归一化为可比较的文本。
 *
 * 只做大小写、引号与空白归一，不做同义改写：定位必须逐字可靠。
 *
 * @param text 原始文本。
 * @returns 归一化文本。
 */
export const normalizeDialogueText = (text: string): string => text
    .toLowerCase()
    .replace(/[\u201c\u201d"'\u2018\u2019]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

/**
 * 从一句台词里取出内容词。
 *
 * 只做正则切分与停用词过滤，不引入后端分词器，保证纯函数可在任意进程运行。
 *
 * @param text 字幕原文。
 * @returns 内容词列表（小写）。
 */
export const extractDialogueContentWords = (text: string): string[] => text
    .toLowerCase()
    .replace(/[^a-z'\s-]/gu, ' ')
    .split(/\s+/u)
    .map((word) => word.replace(/^[-']+|[-']+$/gu, ''))
    .filter((word) => isContentLemma(word));

/**
 * 判断一句字幕是否适合作为对话中的「对方台词」。
 *
 * 要求有足够的内容词、长度适中，且不是纯语气词或纯符号。
 *
 * @param text 字幕原文。
 * @returns 适合作为对方台词时为 true。
 */
export const isUsablePartnerLine = (text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PARTNER_CHARS) {
        return false;
    }
    return extractDialogueContentWords(trimmed).length >= MIN_PARTNER_CONTENT_WORDS;
};

/**
 * 在字幕里定位一句话。
 *
 * 优先按归一化文本精确匹配；找不到时返回 -1，绝不猜测近似行。
 *
 * @param lines 字幕行。
 * @param text 待定位文本。
 * @returns 匹配行的下标；未找到时为 -1。
 */
export const findDialogueLine = (lines: RolePlaySubtitleLine[], text: string): number => {
    const target = normalizeDialogueText(text);
    if (!target) {
        return -1;
    }
    return lines.findIndex((line) => normalizeDialogueText(line.text) === target);
};

/**
 * 从指定位置之后选出下一句对方台词。
 *
 * 只做确定性挑选：跳过不可用行与重复行，不调用模型，也不改写台词。
 *
 * @param lines 全部字幕行。
 * @param afterPosition 已用到的行在数组中的下标；从其后的行开始查找。
 * @param usedLines 已经用过的台词，避免同一句反复出现。
 * @returns 选中的字幕行；没有可用行时返回 null。
 */
export const pickNextPartnerLine = (
    lines: RolePlaySubtitleLine[],
    afterPosition: number,
    usedLines: readonly string[] = [],
): RolePlaySubtitleLine | null => {
    const used = new Set(usedLines.map(normalizeDialogueText));
    let scanned = 0;
    for (let position = afterPosition + 1; position < lines.length; position += 1) {
        if (scanned >= MAX_LOOKAHEAD_LINES) {
            break;
        }
        const line = lines[position];
        scanned += 1;
        if (used.has(normalizeDialogueText(line.text))) {
            continue;
        }
        if (!isUsablePartnerLine(line.text)) {
            continue;
        }
        return line;
    }
    return null;
};

/**
 * 计算多轮对话的下一句台词。
 *
 * 会话只沿字幕向后推进：从开场白之后、且已用台词的最后位置之后继续，
 * 这样重开弹窗后既不会重复台词，也不会跳过字幕。
 *
 * @param lines 全部字幕行。
 * @param openingLine 会话开场白。
 * @param usedLines 已经出现过的对方台词，按轮次顺序。
 * @returns 下一句台词与是否还能继续。
 */
export const resolveNextPartnerLine = (
    lines: RolePlaySubtitleLine[],
    openingLine: string,
    usedLines: readonly string[],
): { next: RolePlaySubtitleLine | null; canContinue: boolean } => {
    const openingIndex = findDialogueLine(lines, openingLine);
    if (openingIndex < 0) {
        return { next: null, canContinue: false };
    }
    const lastUsedPosition = usedLines.reduce((max, text) => {
        const found = findDialogueLine(lines, text);
        return found > max ? found : max;
    }, openingIndex);
    const next = pickNextPartnerLine(lines, lastUsedPosition, [openingLine, ...usedLines]);
    return { next, canContinue: next !== null };
};
