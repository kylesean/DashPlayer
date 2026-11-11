import { describe, expect, it } from 'vitest';

import {
    buildSentenceFromSlotAnswers,
    evaluateSlotTypingChars,
    extractPracticeWordSlots,
    isSlotWordMatch,
    parsePracticePromptTokens,
} from '../practicePromptTokens';

describe('practicePromptTokens 练习词槽解析与校验', () => {
    it('保留缩约词与连字符词为单个词槽，外围引号/标点归入标点骨架', () => {
        const tokens = parsePracticePromptTokens(`"It's a well-known fact," oh - really?`);
        const words = tokens.filter((t) => t.kind === 'word').map((t) => t.text);
        expect(words).toEqual(["It's", 'a', 'well-known', 'fact', 'oh', 'really']);
        expect(tokens.map((t) => t.text).join('')).toBe(`"It's a well-known fact," oh - really?`);
    });

    it('支持撇号与连字符的宽容匹配，同时避免无撇号目标被过度放宽', () => {
        const slots = extractPracticeWordSlots("Don't lose its key.");
        expect(slots.map((s) => s.text)).toEqual(["Don't", 'lose', 'its', 'key']);

        expect(isSlotWordMatch("don't", slots[0])).toBe(true);
        expect(isSlotWordMatch('dont', slots[0])).toBe(true);
        expect(isSlotWordMatch('doesn', slots[0])).toBe(false);
        expect(isSlotWordMatch('ITS', slots[2])).toBe(true);
        expect(isSlotWordMatch("it's", slots[2])).toBe(false);
    });

    it('逐字输入反馈可识别正确前缀与错字母位置', () => {
        expect(evaluateSlotTypingChars('tomo', 'tomorrow')).toEqual([
            { char: 't', correct: true },
            { char: 'o', correct: true },
            { char: 'm', correct: true },
            { char: 'o', correct: true },
        ]);
        expect(evaluateSlotTypingChars('tomr', 'tomorrow')).toEqual([
            { char: 't', correct: true },
            { char: 'o', correct: true },
            { char: 'm', correct: true },
            { char: 'r', correct: false },
        ]);
    });

    it('组合成后端评分句子时已锁定槽位回填原文、空槽跳过', () => {
        const slots = extractPracticeWordSlots("It's fine today");
        const sentence = buildSentenceFromSlotAnswers(
            slots,
            ['its', '', 'todai'],
            [true, false, false],
        );
        expect(sentence).toBe("It's todai");
    });
});
