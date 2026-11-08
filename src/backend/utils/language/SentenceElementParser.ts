import winkNLP from 'wink-nlp';
import type { ItsFunction } from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

const nlp = winkNLP(model);

/**
 * 缩读语素：wink 会把它切成独立 token（如 it's → it + 's、don't → do + n't），
 * 合并回宿主词才符合"一个词"的直觉，查词也才能拿到完整的缩写形式。
 */
const CONTRACTION_CLITIC_PATTERN = /^(?:['’](?:s|re|ve|ll|d|m)|n['’]t)$/i;

/** 合成词连接符：wink 把连字符切成独立标点 token（self-centeredness → self + - + centeredness）。 */
const HYPHEN_TOKEN_PATTERN = /^[-–—]$/;

/** 是否为单词 token（合并判定只作用于词，标点/数字不参与）。 */
const isWordToken = (token: { type: string }): boolean => token.type === 'word';

/** 合并后的 token：text 为规范化展示文本，end 为原句中的片段终点。 */
interface MergedToken {
    text: string;
    lemma: string;
    pos: string;
    type: string;
    start: number;
    end: number;
}

/** 句子中的结构化元素。 */
export interface SentenceElement {
    /** 元素类型。 */
    kind: 'word' | 'text';
    /** 字幕中的原文片段，始终用于展示。 */
    text: string;
    /** wink 根据上下文和词性推导出的 lemma，仅用于内部匹配。 */
    implicit?: string;
    /** wink 识别出的词性。 */
    pos?: string;
    /** wink 识别出的 token 类型。 */
    type?: string;
    /** 在原句中的起始位置。 */
    start: number;
    /** 在原句中的文本长度。 */
    length: number;
}

/** 将句子解析为完整元素流。 */
export interface SentenceElementParser { parse(text: string): SentenceElement[]; }

/**
 * 基于 wink-nlp 的句子元素解析器。
 * wink 对整句进行分词、词性标注和归一化，同时通过原文偏移保留展示文本。
 */
export class WinkSentenceElementParser implements SentenceElementParser {
    /**
     * 分析一整句字幕并保留原文覆盖范围。
     * @param text 待解析字幕原文。
     * @returns 按原文顺序排列、完整覆盖输入文本的元素。
     */
    parse(text: string): SentenceElement[] {
        if (!text) return [];
        const doc = nlp.readDoc(text);
        const values = doc.tokens().out(nlp.its.value as unknown as ItsFunction<string>) as string[];
        const lemmas = doc.tokens().out(nlp.its.lemma as unknown as ItsFunction<string>) as string[];
        const types = doc.tokens().out(nlp.its.type as unknown as ItsFunction<string>) as string[];
        const poses = doc.tokens().out(nlp.its.pos as unknown as ItsFunction<string>) as string[];
        const tokens: Array<{ text: string; lemma: string; type: string; pos: string; start: number }> = [];
        let cursor = 0;
        values.forEach((value, index) => {
            const start = text.indexOf(value, cursor);
            if (start < 0) return;
            tokens.push({ text: value, lemma: lemmas[index] ?? value, type: types[index] ?? 'text', pos: poses[index] ?? '', start });
            cursor = start + value.length;
        });
        const elements: SentenceElement[] = [];
        cursor = 0;
        // 合并 wink 拆散的"直觉上的一个词"：
        // 1. 连字符合成词 self-centeredness（wink → self + - + centeredness），允许
        //    原文在连字符两侧带空格（ASR 常见 "self- centeredness"），展示与查词
        //    都归一为无空格形式；
        // 2. 缩读 it's / don't（wink → it + 's、do + n't），合并回宿主词。
        // 合并词的 lemma 取规范化小写——合成词与缩写不做词形还原，生词匹配仍按原形走。
        const merged: MergedToken[] = [];
        let index = 0;
        while (index < tokens.length) {
            const token = tokens[index];
            if (isWordToken(token)) {
                let chain = index;
                while (chain + 2 < tokens.length) {
                    const hyphen = tokens[chain + 1];
                    const nextWord = tokens[chain + 2];
                    if (!HYPHEN_TOKEN_PATTERN.test(hyphen.text) || !isWordToken(nextWord)) break;
                    // 两侧都留空的连字符更像破折号（one - two），不合并；
                    // 至少一侧紧贴才视为合成词（self-centeredness / "self- centeredness"）。
                    const spaceBefore = hyphen.start > tokens[chain].start + tokens[chain].text.length;
                    const spaceAfter = nextWord.start > hyphen.start + hyphen.text.length;
                    if (spaceBefore && spaceAfter) break;
                    chain += 2;
                }
                if (chain > index) {
                    const last = tokens[chain];
                    const surface = text.slice(token.start, last.start + last.text.length).replace(/\s+/g, '');
                    merged.push({ text: surface, lemma: surface.toLowerCase(), pos: token.pos, type: 'word', start: token.start, end: last.start + last.text.length });
                    index = chain + 1;
                    continue;
                }
                const next = tokens[index + 1];
                if (next && CONTRACTION_CLITIC_PATTERN.test(next.text)) {
                    const surface = `${token.text}${next.text}`;
                    merged.push({ text: surface, lemma: surface.toLowerCase(), pos: token.pos, type: 'word', start: token.start, end: next.start + next.text.length });
                    index += 2;
                    continue;
                }
            }
            merged.push({ text: token.text, lemma: token.lemma, pos: token.pos, type: token.type, start: token.start, end: token.start + token.text.length });
            index += 1;
        }
        merged.forEach((token) => {
            if (token.start > cursor) elements.push({ kind: 'text', text: text.slice(cursor, token.start), start: cursor, length: token.start - cursor });
            const isWord = token.type === 'word';
            elements.push({ kind: isWord ? 'word' : 'text', text: token.text, implicit: isWord ? token.lemma : undefined, pos: token.pos, type: token.type, start: token.start, length: token.end - token.start });
            cursor = token.end;
        });
        if (cursor < text.length) elements.push({ kind: 'text', text: text.slice(cursor), start: cursor, length: text.length - cursor });
        return elements.filter((element) => element.length > 0);
    }
}
