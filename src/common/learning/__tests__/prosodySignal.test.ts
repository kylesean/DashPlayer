import { describe, expect, it } from 'vitest';

import {
    analyzeSentenceProsody,
    analyzeSentencesProsody,
    buildEnergyEnvelope,
    detectProsodyShifts,
    meanSquareToDb,
    PROSODY_SILENCE_DB,
    sliceEnvelope,
    type SentenceProsody,
} from '@/common/learning/prosodySignal';

/**
 * 按给定「有声/静音」模式生成 16kHz 采样。
 *
 * @param pattern 每段持续秒数，正值为有声、负值为静音。
 * @param amplitude 有声段振幅（0-1）。
 * @returns 单声道采样。
 */
const synth = (pattern: readonly number[], amplitude = 0.5): Int16Array => {
    const sampleRate = 16000;
    const chunks: number[] = [];
    for (const seconds of pattern) {
        const count = Math.round(Math.abs(seconds) * sampleRate);
        const value = seconds > 0 ? Math.round(amplitude * 32767) : 0;
        for (let index = 0; index < count; index += 1) {
            // 交替正负，避免直流偏置影响均方。
            chunks.push(index % 2 === 0 ? value : -value);
        }
    }
    return Int16Array.from(chunks);
};

describe('meanSquareToDb', () => {
    it('零与非法值落到静音下限', () => {
        expect(meanSquareToDb(0)).toBe(PROSODY_SILENCE_DB);
        expect(meanSquareToDb(Number.NaN)).toBe(PROSODY_SILENCE_DB);
    });

    it('满幅正弦的均方约 -3dB', () => {
        expect(meanSquareToDb(0.5)).toBeCloseTo(-3.01, 1);
    });
});

describe('buildEnergyEnvelope', () => {
    it('按分辨率聚合，静音段明显低于有声段', () => {
        const samples = synth([1, -1]);
        const envelope = buildEnergyEnvelope({ samples, sampleRate: 16000, bucketSec: 0.1 });

        expect(envelope).toHaveLength(20);
        expect(envelope[0]).toBeGreaterThan(-10);
        expect(envelope[15]).toBe(PROSODY_SILENCE_DB);
    });

    it('样本不足一格时返回空数组', () => {
        const samples = synth([0.01]);
        expect(buildEnergyEnvelope({ samples, sampleRate: 16000, bucketSec: 0.1 })).toEqual([]);
    });
});

describe('sliceEnvelope', () => {
    it('按句起止切出对应格数', () => {
        const envelope = Array.from({ length: 100 }, (_, index) => -index);
        expect(sliceEnvelope(envelope, 0.1, 1, 2)).toHaveLength(10);
    });

    it('区间为空或越界时返回空数组', () => {
        expect(sliceEnvelope([1, 2, 3], 0.1, 2, 2)).toEqual([]);
        expect(sliceEnvelope([1, 2, 3], 0.1, 100, 200)).toEqual([]);
    });
});

describe('analyzeSentenceProsody', () => {
    it('有声与静音交替时给出语速与能量', () => {
        const samples = synth([0.5, -0.2, 0.5, -0.2, 0.5]);
        const envelope = buildEnergyEnvelope({ samples, sampleRate: 16000 });
        const prosody = analyzeSentenceProsody({
            envelope,
            frameSec: 0.1,
            sentence: { index: 3, start: 0, end: 1.9, text: 'We should leave before the storm arrives.' },
        });

        expect(prosody).not.toBeNull();
        expect(prosody?.wordCount).toBe(7);
        expect(prosody?.voicedRatio).toBeCloseTo(0.79, 1);
        expect(prosody?.speechRate).toBeGreaterThan(0);
    });

    it('全程静音时返回 null', () => {
        const envelope = Array.from({ length: 30 }, () => PROSODY_SILENCE_DB);
        expect(analyzeSentenceProsody({
            envelope,
            frameSec: 0.1,
            sentence: { index: 0, start: 0, end: 3, text: 'hello there' },
        })).toBeNull();
    });

    it('恒定噪声没有峰值差时返回 null', () => {
        const envelope = Array.from({ length: 30 }, () => -30);
        expect(analyzeSentenceProsody({
            envelope,
            frameSec: 0.1,
            sentence: { index: 0, start: 0, end: 3, text: 'hello there' },
        })).toBeNull();
    });
});

/**
 * 构造一句韵律特征，只覆盖判定用到的字段。
 */
const signal = (overrides: Partial<SentenceProsody> = {}): SentenceProsody => ({
    index: 0,
    start: 0,
    end: 2,
    wordCount: 8,
    voicedRatio: 0.9,
    energyDb: -20,
    speechRate: 4,
    ...overrides,
});

describe('detectProsodyShifts', () => {
    it('语速骤增产生 rate 突变', () => {
        const shifts = detectProsodyShifts([
            signal({ index: 0, start: 0, end: 2, speechRate: 3 }),
            signal({ index: 1, start: 2, end: 4, speechRate: 6 }),
        ]);

        expect(shifts).toEqual([
            { sentenceIndex: 1, atSec: 2, reason: 'rate', detail: 2 },
        ]);
    });

    it('语速骤减同样产生 rate 突变', () => {
        const shifts = detectProsodyShifts([
            signal({ index: 0, start: 0, end: 2, speechRate: 6 }),
            signal({ index: 1, start: 2, end: 4, speechRate: 2 }),
        ]);

        expect(shifts[0].reason).toBe('rate');
    });

    it('语速相近但音量骤变时产生 energy 突变', () => {
        const shifts = detectProsodyShifts([
            signal({ index: 0, start: 0, end: 2, energyDb: -30 }),
            signal({ index: 1, start: 2, end: 4, energyDb: -18 }),
        ]);

        expect(shifts).toEqual([
            { sentenceIndex: 1, atSec: 2, reason: 'energy', detail: 12 },
        ]);
    });

    it('短语不参与判定，避免把单词回应当成换场', () => {
        const shifts = detectProsodyShifts([
            signal({ index: 0, start: 0, end: 2, wordCount: 2, speechRate: 3 }),
            signal({ index: 1, start: 2, end: 4, wordCount: 2, speechRate: 9 }),
        ]);

        expect(shifts).toEqual([]);
    });

    it('有声时长过短的句子不参与判定', () => {
        const shifts = detectProsodyShifts([
            signal({ index: 0, start: 0, end: 0.6, speechRate: 3 }),
            signal({ index: 1, start: 0.6, end: 1.2, speechRate: 9 }),
        ]);

        expect(shifts).toEqual([]);
    });
});

describe('analyzeSentencesProsody', () => {
    it('按字幕句切片并跳过无韵律的句子', () => {
        const samples = synth([1, -0.5, 1]);
        const envelope = buildEnergyEnvelope({ samples, sampleRate: 16000 });
        const result = analyzeSentencesProsody({
            envelope,
            frameSec: 0.1,
            sentences: [
                { index: 0, start: 0, end: 1.5, text: 'We should leave before the storm arrives.' },
                { index: 1, start: 1.5, end: 2.5, text: 'yes' },
            ],
        });

        expect(result).toHaveLength(1);
        expect(result[0].index).toBe(0);
    });
});
