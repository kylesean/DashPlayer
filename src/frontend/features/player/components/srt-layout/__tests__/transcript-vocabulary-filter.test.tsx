import { describe, expect, it } from 'vitest';

import type { Sentence } from '@/common/types/SentenceC';
import {
    filterTranscriptSentences,
    type SentenceVocabularyCount,
} from '@/frontend/features/player/transcriptVocabulary';

const sentenceOf = (index: number, text: string): Sentence => ({
    fileHash: 'hash-filter',
    index,
    start: index,
    end: index + 1,
    adjustedStart: null,
    adjustedEnd: null,
    text,
    textZH: '',
    key: `key-${index}`,
    transGroup: 1,
    translationKey: `hash-filter:${index}`,
    struct: { original: '', blocks: [] },
});

/**
 * 文稿筛选的三条不变量。
 *
 * 这里刻意测「筛选后的列表」而不是菜单 DOM：菜单的语义由 Astryx 的
 * DropdownMenuRadioGroup 保证（role="menuitemradio"），项目自己要保证的是
 * 筛完之后列表仍然能正确渲染、定位与保留当前句。
 */
describe('transcript vocabulary filter', () => {
    const sentences = [
        sentenceOf(1, 'alpha one'),
        sentenceOf(2, 'beta two'),
        sentenceOf(3, 'gamma three'),
        sentenceOf(4, 'delta four'),
    ];
    const counts = new Map<string, SentenceVocabularyCount>([
        ['hash-filter:1', { learning: 2, familiar: 0 }],
        ['hash-filter:2', { learning: 0, familiar: 1 }],
        ['hash-filter:3', { learning: 0, familiar: 0 }],
        ['hash-filter:4', { learning: 1, familiar: 1 }],
    ]);
    const countOf = (sentence: Sentence) =>
        counts.get(`${sentence.fileHash}:${sentence.index}`) ?? { learning: 0, familiar: 0 };

    it('filters to sentences that actually paint the selected annotation', () => {
        expect(filterTranscriptSentences(sentences, 'learning', countOf).map((s) => s.index)).toEqual([1, 4]);
        expect(filterTranscriptSentences(sentences, 'familiar', countOf).map((s) => s.index)).toEqual([2, 4]);
    });

    it('keeps the playing sentence even when it matches nothing', () => {
        const kept = filterTranscriptSentences(
            sentences,
            'learning',
            countOf,
            (sentence) => sentence.index === 3,
        );

        expect(kept.map((s) => s.index)).toEqual([1, 3, 4]);
    });

    it('leaves the list untouched for the all filter so scroll positions stay valid', () => {
        expect(filterTranscriptSentences(sentences, 'all', countOf)).toBe(sentences);
    });
});
