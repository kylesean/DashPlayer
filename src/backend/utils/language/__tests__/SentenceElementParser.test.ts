import { describe, expect, it } from 'vitest';

import { WinkSentenceElementParser } from '@/backend/utils/language/SentenceElementParser';

const parser = new WinkSentenceElementParser();

/** 提取全部 word 元素的展示文本。 */
const words = (text: string): string[] =>
    parser.parse(text).filter((element) => element.kind === 'word').map((element) => element.text);

/** 校验元素流无重叠地完整覆盖原文。 */
const expectFullCoverage = (text: string): void => {
    const elements = parser.parse(text);
    let cursor = 0;
    for (const element of elements) {
        expect(element.start).toBe(cursor);
        expect(element.length).toBeGreaterThan(0);
        cursor = element.start + element.length;
    }
    expect(cursor).toBe(text.length);
};

describe('WinkSentenceElementParser 词元合并', () => {
    it('缩读 it\'s / don\'t 合并为单个词元，查词拿到完整缩写', () => {
        expect(words("It's fine, don't worry.")).toEqual(['It\'s', 'fine', 'don\'t', 'worry']);
    });

    it('连字符合成词 self-centeredness 合并为单个词元（真实 5yCqhY1D-VE 句）', () => {
        expect(words("Um sometimes it's it's again this self-centeredness."))
            .toEqual(['Um', 'sometimes', 'it\'s', 'it\'s', 'again', 'this', 'self-centeredness']);
    });

    it('ASR 连字符一侧带空格（self- centeredness）同样合并并归一化', () => {
        expect(words('this self- centeredness thing')).toEqual(['this', 'self-centeredness', 'thing']);
    });

    it('两侧留空的连字符视为破折号，不合并', () => {
        expect(words('one - two things')).toEqual(['one', 'two', 'things']);
    });

    it('多段连字符链（well-known-highly）整体合并', () => {
        expect(words('a well-known highly-regarded author')).toContain('well-known');
        expect(words('a well-known highly-regarded author')).toContain('highly-regarded');
    });

    it('合并后元素流仍完整无重叠覆盖原文（间隙保留给空格与标点）', () => {
        const text = "Um sometimes it's it's again this self-centeredness.";
        const elements = parser.parse(text);
        expectFullCoverage(text);
        // 合并词元之间的间隙应以空白/标点等文本元素存在，句子信息不丢失
        const wordTexts = elements.filter((element) => element.kind === 'word').map((element) => element.text);
        expect(wordTexts.filter((word) => word.includes("'s"))).toHaveLength(2);
    });

    it('合并词元的 lemma 为规范化小写，供生词匹配与查词归一', () => {
        const elements = parser.parse("It's self-centeredness.");
        const mergedWord = elements.find((element) => element.kind === 'word' && element.text === 'self-centeredness');
        expect(mergedWord?.implicit).toBe('self-centeredness');
    });
});
