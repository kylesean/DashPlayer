import { describe, expect, it } from 'vitest';

import {
    buildWordSyllableFeedback,
    compareSyllableCount,
    splitIpaSyllables,
    SYLLABLE_STRESS_MARGIN,
} from '@/common/utils/practice/syllableFeedback';

describe('splitIpaSyllables', () => {
    it('按元音核切分音节', () => {
        const syllables = splitIpaSyllables('/ˌserənˈdɪpəti/');
        // 元音之间的辅音串整体归入后一个音节；这里只关心音节数与重音位置。
        expect(syllables.map((syllable) => syllable.text)).toEqual([
            'ˌserən',
            'ˈdɪp',
            'ət',
            'i',
        ]);
    });

    it('标记主重音所在音节', () => {
        const syllables = splitIpaSyllables('/ˈdɪpəti/');
        expect(syllables.find((syllable) => syllable.stressed)?.index).toBe(0);
    });

    it('次重音不算主重音', () => {
        const syllables = splitIpaSyllables('/ˌserənˈdɪpəti/');
        const stressed = syllables.filter((syllable) => syllable.stressed);
        expect(stressed).toHaveLength(1);
        expect(stressed[0].index).toBe(1);
    });

    it('没有音标或没有元音时返回空数组', () => {
        expect(splitIpaSyllables('')).toEqual([]);
        expect(splitIpaSyllables('/ʃ/')).toEqual([]);
    });

    it('兼容不带斜杠的音标', () => {
        expect(splitIpaSyllables('ˈhɛloʊ').length).toBe(2);
    });
});

describe('compareSyllableCount', () => {
    it('差异在容差内判为一致', () => {
        expect(compareSyllableCount(5, 5 * 0.22).verdict).toBe('match');
    });

    it('说得明显更短判为 fewer', () => {
        expect(compareSyllableCount(10, 10 * 0.22 * 0.5).verdict).toBe('fewer');
    });

    it('说得明显更长判为 more', () => {
        expect(compareSyllableCount(4, 4 * 0.22 * 2).verdict).toBe('more');
    });

    it('输入不可用时返回 unknown 而不是编造结论', () => {
        expect(compareSyllableCount(0, 2).verdict).toBe('unknown');
        expect(compareSyllableCount(5, 0).verdict).toBe('unknown');
    });
});

describe('buildWordSyllableFeedback', () => {
    it('没有音标时只返回空结构，不猜测重音', () => {
        const feedback = buildWordSyllableFeedback('hello', null, null);
        expect(feedback.syllables).toEqual([]);
        expect(feedback.stressIndex).toBeNull();
        expect(feedback.spokenStressIndex).toBeNull();
        expect(feedback.stressAligned).toBeNull();
    });

    it('没有逐音节能量时不判断用户重读位置', () => {
        const feedback = buildWordSyllableFeedback('hello', '/hɛˈloʊ/', null);
        expect(feedback.stressIndex).toBe(1);
        expect(feedback.spokenStressIndex).toBeNull();
        expect(feedback.stressAligned).toBeNull();
    });

    it('能量峰值与参考重音一致时判为对齐', () => {
        const feedback = buildWordSyllableFeedback('hello', '/hɛˈloʊ/', [0.3, 1]);
        expect(feedback.spokenStressIndex).toBe(1);
        expect(feedback.stressAligned).toBe(true);
    });

    it('能量峰值与参考重音不一致时判为错位', () => {
        const feedback = buildWordSyllableFeedback('hello', '/ˈhɛloʊ/', [1, 0.2]);
        expect(feedback.stressIndex).toBe(0);
        expect(feedback.spokenStressIndex).toBe(0);
        expect(feedback.stressAligned).toBe(true);

        const shifted = buildWordSyllableFeedback('hello', '/hɛˈloʊ/', [1, 0.2]);
        expect(shifted.spokenStressIndex).toBe(0);
        expect(shifted.stressAligned).toBe(false);
    });

    it('能量起伏过小时不判定重音落点', () => {
        const flat = 1 - SYLLABLE_STRESS_MARGIN / 2;
        const feedback = buildWordSyllableFeedback('hello', '/hɛˈloʊ/', [flat, 1]);
        expect(feedback.spokenStressIndex).toBeNull();
        expect(feedback.stressAligned).toBeNull();
    });

    it('音节数与能量数组长度不一致时不判断', () => {
        const feedback = buildWordSyllableFeedback('hello', '/hɛˈloʊ/', [1]);
        expect(feedback.spokenStressIndex).toBeNull();
    });

    it('单音节词不判断重音位置', () => {
        const feedback = buildWordSyllableFeedback('cat', '/kæt/', [1]);
        expect(feedback.spokenStressIndex).toBeNull();
    });
});
