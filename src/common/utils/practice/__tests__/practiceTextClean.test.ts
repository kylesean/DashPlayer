import { describe, expect, it } from 'vitest';
import { stripNonSpeechAnnotations } from '@/common/utils/practice/practiceTextClean';
import { alignPracticeTokens, normalizePracticeTokens } from '@/common/utils/practice/pronunciationScoring';

describe('stripNonSpeechAnnotations', () => {
    it('剥离方括号舞台/音效标注与音乐符号', () => {
        expect(stripNonSpeechAnnotations('Why would you waste [music] a minute?'))
            .toBe('Why would you waste a minute?');
        expect(stripNonSpeechAnnotations('[applause] Thank you! [laughter]'))
            .toBe('Thank you!');
        expect(stripNonSpeechAnnotations('♪ Happy birthday ♪'))
            .toBe('Happy birthday');
        expect(stripNonSpeechAnnotations('>> SPEAKER 1: Let us begin.'))
            .toBe('Let us begin.');
    });

    it('剥离常见圆括号音效标注但保留普通语义括号', () => {
        expect(stripNonSpeechAnnotations('Hello (laughter) world')).toBe('Hello world');
        expect(stripNonSpeechAnnotations('It cost (about) ten dollars')).toBe('It cost (about) ten dollars');
    });

    it('normalizePracticeTokens 不再把 [music] 计入期望词', () => {
        expect(normalizePracticeTokens('Why would you waste [music] a minute?'))
            .toEqual(['why', 'would', 'you', 'waste', 'a', 'minute']);
        const res = alignPracticeTokens('Why would you waste [music] a minute?', 'why would you waste a minute');
        expect(res.score).toBe(100);
    });
});
