import { describe, expect, it } from 'vitest';
import type { Sentence } from '@/common/types/SentenceC';
import type { SentencePracticeSummaryVO } from '@/common/contracts/sentence-practice';
import {
    buildPracticeUnits,
    matchesPracticeFilter,
    unitHasActiveVocab,
} from '../practiceUnit';
import { computeWaveformBins } from '../audioFeedback';

const makeSentence = (
    index: number,
    text: string,
    start: number,
    end: number,
): Sentence => ({
    fileHash: 'hash-u',
    index,
    start,
    end,
    adjustedStart: null,
    adjustedEnd: null,
    text,
    textZH: `译文 ${index}`,
    key: `hash-u-${index}`,
    transGroup: 1,
    translationKey: `hash-u:${index}`,
    struct: { original: text, blocks: [] },
});

describe('practiceUnit 练习单元归并与队列筛选', () => {
    it('整句模式开启时把碎句归并为同一练习单元并合并时间区间与原文', () => {
        const s0 = makeSentence(0, 'I think we should', 1, 2.5);
        const s1 = makeSentence(1, 'finish this today.', 2.8, 4.4);
        const s2 = makeSentence(2, 'Agreed.', 6.0, 7.0);

        const rawUnits = buildPracticeUnits([s0, s1, s2], null, false);
        expect(rawUnits).toHaveLength(3);

        const blockUnits = buildPracticeUnits([s0, s1, s2], null, true);
        expect(blockUnits).toHaveLength(2);
        expect(blockUnits[0].text).toBe('I think we should finish this today.');
        expect(blockUnits[0].textZH).toBe('译文 0 译文 1');
        expect(blockUnits[0].range).toEqual({ start: 1, end: 4.4 });
    });

    it('支持按未练、低分(<80)与含生词精准筛选单元', () => {
        const u0 = buildPracticeUnits([makeSentence(0, 'Remember this word', 0, 2)], null, false)[0];
        const u1 = buildPracticeUnits([makeSentence(1, 'Simple line', 3, 5)], null, false)[0];
        const u2 = buildPracticeUnits([makeSentence(2, 'Another sentence', 6, 8)], null, false)[0];

        const summaries = new Map<number, SentencePracticeSummaryVO>([
            [0, { sentenceIndex: 0, bestScore: 65, attemptCount: 2, lastMode: 'dictation', lastPracticedAt: '2026-11-12' }],
            [1, { sentenceIndex: 1, bestScore: 95, attemptCount: 1, lastMode: 'shadowing', lastPracticedAt: '2026-11-12' }],
        ]);
        const vocab = {
            isVocabularyWord: (w: string) => w === 'remember',
            getBaseWord: (w: string) => w,
        };

        expect(unitHasActiveVocab(u0, vocab.isVocabularyWord, vocab.getBaseWord)).toBe(true);
        expect(unitHasActiveVocab(u1, vocab.isVocabularyWord, vocab.getBaseWord)).toBe(false);

        expect(matchesPracticeFilter(u2, 'unpracticed', summaries, vocab)).toBe(true);
        expect(matchesPracticeFilter(u0, 'unpracticed', summaries, vocab)).toBe(false);

        expect(matchesPracticeFilter(u0, 'weak', summaries, vocab)).toBe(true);
        expect(matchesPracticeFilter(u1, 'weak', summaries, vocab)).toBe(false);

        expect(matchesPracticeFilter(u0, 'vocab', summaries, vocab)).toBe(true);
        expect(matchesPracticeFilter(u2, 'vocab', summaries, vocab)).toBe(false);
    });

    it('computeWaveformBins 按声道振幅输出归一化包络柱高', () => {
        const fakeBuffer = {
            getChannelData: () => new Float32Array([0, 0.25, 0.5, 1.0]),
        } as unknown as AudioBuffer;
        const bins = computeWaveformBins(fakeBuffer, 4);
        expect(bins).toHaveLength(4);
        expect(bins[3]).toBe(1);
        expect(bins[0]).toBeGreaterThanOrEqual(0.08);
        expect(bins[1]).toBeLessThan(bins[2]);
    });
});
