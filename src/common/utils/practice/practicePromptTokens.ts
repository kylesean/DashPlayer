/**
 * 练习工坊专用词槽解析与即时校验工具。
 *
 * 与通用 `splitWords`（服务于字幕点击查词）刻意区分：
 * - 将英文缩约词（it's / don't / we'll）和连字符复合词（well-known）保留为单个可填/可高亮词槽；
 * - 将前后标点、引号与空格保留为不可输入的静态骨架，使词槽排版与听写手感自然连贯。
 */

const PROMPT_WORD_REGEX =
    /[A-Za-z0-9\u4e00-\u9fa5]+(?:['’-][A-Za-z0-9\u4e00-\u9fa5]+)*/g;

/** 文本切分后的三种骨架元素。 */
export type PracticePromptToken =
    | {
        kind: 'word';
        /** 在原句所有可填词槽中的顺序下标（0-based）。 */
        slotIndex: number;
        /** 原文展示文本（保留原始大小写）。 */
        text: string;
        /** 标准化拼写（保留撇号与连字符）。 */
        normalized: string;
        /** 去除撇号与连字符后的兼容形态。 */
        compactNormalized: string;
    }
    | {
        kind: 'gap';
        text: string;
    }
    | {
        kind: 'punctuation';
        text: string;
    };

/** 提取文本中的标准化比对串。 */
export function normalizeSlotText(raw: string, compact = false): string {
    const unified = raw
        .trim()
        .toLowerCase()
        .replace(/’/g, "'")
        .replace(/[^a-z0-9\u4e00-\u9fa5'-]/g, '');
    return compact ? unified.replace(/['-]/g, '') : unified;
}

/**
 * 把原句拆分为词槽、空格与标点骨架序列。
 */
export function parsePracticePromptTokens(text: string): PracticePromptToken[] {
    if (!text) return [];
    const normalizedInput = text.replace(/\s+/g, ' ');
    const tokens: PracticePromptToken[] = [];
    let cursor = 0;
    let slotIndex = 0;

    for (const match of normalizedInput.matchAll(PROMPT_WORD_REGEX)) {
        const wordText = match[0];
        const start = match.index ?? 0;
        if (start > cursor) {
            pushNonWordTokens(tokens, normalizedInput.slice(cursor, start));
        }
        tokens.push({
            kind: 'word',
            slotIndex,
            text: wordText,
            normalized: normalizeSlotText(wordText, false),
            compactNormalized: normalizeSlotText(wordText, true),
        });
        slotIndex += 1;
        cursor = start + wordText.length;
    }

    if (cursor < normalizedInput.length) {
        pushNonWordTokens(tokens, normalizedInput.slice(cursor));
    }

    return tokens;
}

function pushNonWordTokens(tokens: PracticePromptToken[], segment: string): void {
    // 按空白符切片，分别落入 gap 或 punctuation，方便样式精确控制换行与间距
    const pieces = segment.split(/(\s+)/).filter((p) => p.length > 0);
    for (const piece of pieces) {
        if (/^\s+$/.test(piece)) {
            tokens.push({ kind: 'gap', text: piece });
        } else {
            tokens.push({ kind: 'punctuation', text: piece });
        }
    }
}

/** 仅提取词槽列表（按句子从左到右顺序）。 */
export type PracticeWordSlot = Extract<PracticePromptToken, { kind: 'word' }>;

export function extractPracticeWordSlots(text: string): PracticeWordSlot[] {
    return parsePracticePromptTokens(text).filter(
        (token): token is PracticeWordSlot => token.kind === 'word',
    );
}

/**
 * 判断用户输入是否匹配目标词槽。
 *
 * 目标词含缩约撇号或连字符时，同时兼容省略撇号/连字符的敲法（例如 dont → don't）。
 */
export function isSlotWordMatch(typed: string, slot: PracticeWordSlot): boolean {
    const strictTyped = normalizeSlotText(typed, false);
    if (!strictTyped) return false;
    if (strictTyped === slot.normalized) return true;
    const hasJoiner = slot.text.includes("'") || slot.text.includes('’') || slot.text.includes('-');
    if (!hasJoiner) return false;
    return normalizeSlotText(typed, true) === slot.compactNormalized;
}

/** 字符级实时比对状态：用于词槽内边敲边标红错字母。 */
export interface SlotCharFeedback {
    char: string;
    correct: boolean;
}

/**
 * 对正在输入的词做逐字符纠错比对（大小写与 ’ 不敏感）。
 */
export function evaluateSlotTypingChars(typed: string, expected: string): SlotCharFeedback[] {
    const cleanTyped = typed.replace(/’/g, "'");
    const cleanExpected = expected.replace(/’/g, "'");
    const chars = Array.from(cleanTyped);
    const expectedChars = Array.from(cleanExpected);
    return chars.map((ch, idx) => ({
        char: typed[idx] ?? ch,
        correct: idx < expectedChars.length && ch.toLowerCase() === expectedChars[idx].toLowerCase(),
    }));
}

/**
 * 由词槽答案拼回提交给后端评分服务的完整文本。
 * 已通过词槽回填原文规范形态，使后端 `alignPracticeTokens` 与前端判定严格对齐。
 */
export function buildSentenceFromSlotAnswers(
    slots: PracticeWordSlot[],
    answers: string[],
    locked: boolean[],
): string {
    return slots
        .map((slot, idx) => {
            if (locked[idx]) {
                return slot.text;
            }
            const raw = (answers[idx] ?? '').trim();
            return raw.length > 0 ? raw : '';
        })
        .filter((part) => part.length > 0)
        .join(' ');
}
