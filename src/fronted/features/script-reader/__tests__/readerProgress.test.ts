import { beforeEach, describe, expect, it } from 'vitest';

import type { Sentence } from '@/common/types/SentenceC';
import { EMPTY_SENTENCE_VOCABULARY_COUNT } from '@/fronted/features/player/transcriptVocabulary';
import {
    collectReaderVocabularySummary,
    filterReaderSentences,
    getSavedReaderProgress,
    saveReaderProgress,
} from '../lib/readerProgress';

const sentence = (index: number, text: string, textZH = ''): Sentence => ({
    fileHash: 'hash',
    index,
    start: index * 5,
    end: index * 5 + 4,
    adjustedStart: null,
    adjustedEnd: null,
    text,
    textZH,
    key: `hash-${index}`,
    transGroup: 1,
    translationKey: `hash:${index}`,
    struct: { original: text, blocks: [] },
});

describe('readerProgress & filterReaderSentences', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('persists and retrieves last read sentence index per videoId', () => {
        expect(getSavedReaderProgress('vid-1')).toBeNull();
        saveReaderProgress('vid-1', 12);
        expect(getSavedReaderProgress('vid-1')).toBe(12);
    });

    it('filters by saved keys and bilingual search query', () => {
        const list = [
            sentence(0, 'Profound magic in daily life.', '日常生活里的深邃魔法。'),
            sentence(1, 'Simple morning routine.', '简单的晨间习惯。'),
        ];
        const saved = new Set(['hash:1']);

        const bySaved = filterReaderSentences({
            sentences: list,
            filter: 'saved',
            query: '',
            countOf: () => EMPTY_SENTENCE_VOCABULARY_COUNT,
            savedKeys: saved,
        });
        expect(bySaved.map((s) => s.index)).toEqual([1]);

        const byZhQuery = filterReaderSentences({
            sentences: list,
            filter: 'all',
            query: '魔法',
            countOf: () => EMPTY_SENTENCE_VOCABULARY_COUNT,
            savedKeys: saved,
        });
        expect(byZhQuery.map((s) => s.index)).toEqual([0]);
    });

    it('collects top learning vocabulary words ordered by frequency', () => {
        const list = [
            sentence(0, 'The profound idea requires profound patience.'),
            sentence(1, 'Another resilient approach to learning.'),
        ];
        const statusMap: Record<string, 'learning' | 'known'> = {
            profound: 'learning',
            resilient: 'learning',
            idea: 'known',
        };

        const summary = collectReaderVocabularySummary(
            list,
            (word, lemma) => statusMap[(lemma || word).toLowerCase()],
            5,
        );

        expect(summary).toEqual([
            { word: 'profound', count: 2, firstSentenceIndex: 0 },
            { word: 'resilient', count: 1, firstSentenceIndex: 1 },
        ]);
    });
});
