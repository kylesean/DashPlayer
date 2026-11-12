import { describe, expect, it } from 'vitest';

import {
    buildRhythmTrend,
    RHYTHM_TREND_MIN_SAMPLES,
    toRhythmTrendPoint,
} from '@/common/learning/rhythmTrend';
import type { SentencePracticeRhythmFeedback } from '@/common/contracts/sentence-practice';

const rhythm = (
    overrides: Partial<SentencePracticeRhythmFeedback> = {},
): SentencePracticeRhythmFeedback => ({
    speechDurationSec: 2,
    averageWordDurationSec: 0.3,
    paceRatio: 1,
    pace: 'steady',
    words: [],
    notes: [],
    ...overrides,
});

describe('toRhythmTrendPoint', () => {
    it('没有录音时所有派生字段为空，但保留分数', () => {
        const point = toRhythmTrendPoint('2026-01-01T00:00:00.000Z', 80, null);
        expect(point.score).toBe(80);
        expect(point.paceRatio).toBeNull();
        expect(point.syllableDelta).toBeNull();
        expect(point.stressShiftedWords).toBeNull();
    });

    it('音节偏差按估计值减参考值计算', () => {
        const point = toRhythmTrendPoint('2026-01-01T00:00:00.000Z', 80, rhythm({
            syllables: { reference: 10, estimated: 7, verdict: 'fewer' },
        }));
        expect(point.syllableDelta).toBe(-3);
    });

    it('音节结论为 unknown 时不产生偏差', () => {
        const point = toRhythmTrendPoint('2026-01-01T00:00:00.000Z', 80, rhythm({
            syllables: { reference: 0, estimated: 0, verdict: 'unknown' },
        }));
        expect(point.syllableDelta).toBeNull();
    });

    it('只统计能判断重音的词', () => {
        const point = toRhythmTrendPoint('2026-01-01T00:00:00.000Z', 80, rhythm({
            words: [
                { word: 'a', durationSec: 0.3, emphasis: 0.5, stressed: false, stressAligned: false },
                { word: 'b', durationSec: 0.3, emphasis: 0.5, stressed: false, stressAligned: true },
                { word: 'c', durationSec: 0.3, emphasis: 0.5, stressed: false },
            ],
        }));
        expect(point.stressShiftedWords).toBe(1);
    });
});

describe('buildRhythmTrend', () => {
    const points = (paceRatios: number[]) => paceRatios.map((paceRatio, index) => (
        toRhythmTrendPoint(`2026-01-0${index + 1}T00:00:00.000Z`, 70 + index, rhythm({ paceRatio }))
    ));

    it('样本不足时明确返回 insufficient', () => {
        const result = buildRhythmTrend(points([1.4, 1.2]));
        expect(result.verdict).toBe('insufficient');
        expect(result.paceDelta).toBeNull();
    });

    it('样本数达到阈值才开始判断', () => {
        const result = buildRhythmTrend(points([1.4, 1.3, 1.05]));
        expect(result.points).toHaveLength(RHYTHM_TREND_MIN_SAMPLES);
        expect(result.verdict).not.toBe('insufficient');
    });

    it('语速更接近原速判为改善', () => {
        const result = buildRhythmTrend(points([1.6, 1.5, 1.1, 1.05]));
        expect(result.verdict).toBe('improving');
        expect(result.paceDelta).toBeLessThan(0);
    });

    it('语速离原速更远判为退步', () => {
        const result = buildRhythmTrend(points([1.0, 1.0, 1.5, 1.55]));
        expect(result.verdict).toBe('regressing');
    });

    it('变化幅度很小时判为 steady', () => {
        const result = buildRhythmTrend(points([1.0, 1.02, 1.01, 1.0]));
        expect(result.verdict).toBe('steady');
    });

    it('重音错位减少优先作为改善信号', () => {
        const shifted = (count: number, index: number) => toRhythmTrendPoint(
            `2026-01-0${index + 1}T00:00:00.000Z`,
            80,
            rhythm({
                paceRatio: 1,
                words: Array.from({ length: 4 }, (_, wordIndex) => ({
                    word: `w${wordIndex}`,
                    durationSec: 0.3,
                    emphasis: 0.5,
                    stressed: false,
                    stressAligned: wordIndex >= count,
                })),
            }),
        );
        const result = buildRhythmTrend([shifted(3, 0), shifted(3, 1), shifted(0, 2), shifted(0, 3)]);
        expect(result.verdict).toBe('improving');
        expect(result.stressDelta).toBeLessThan(0);
    });

    it('没有任何节奏快照时不会除零或抛错', () => {
        const empty = [toRhythmTrendPoint('2026-01-01T00:00:00.000Z', 70, null)];
        const result = buildRhythmTrend(empty);
        expect(result.verdict).toBe('insufficient');
        expect(Number.isFinite(result.paceDelta ?? 0)).toBe(true);
    });
});
