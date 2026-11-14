import { describe, expect, it } from 'vitest';

import type { Sentence } from '@/common/types/SentenceC';
import type { VocabularySnapshot } from '@/frontend/features/player/transcriptVocabulary';
import {
    countSentenceVocabulary,
    EMPTY_SENTENCE_VOCABULARY_COUNT,
    filterTranscriptSentences,
    resolveStatusFromSnapshot,
    sentenceVocabularyKey,
} from '@/frontend/features/player/transcriptVocabulary';

const sentenceOf = (overrides: Partial<Sentence>): Sentence => ({
    fileHash: 'hash-1',
    index: 1,
    start: 0,
    end: 5,
    adjustedStart: null,
    adjustedEnd: null,
    text: '',
    textZH: '',
    key: 'key-1',
    transGroup: 1,
    translationKey: 'hash-1:1',
    struct: { original: '', blocks: [] },
    ...overrides,
});

const snapshotOf = (
    statuses: Record<string, 'learning' | 'familiar' | 'known' | 'ignored'>,
    forms: Record<string, string> = {},
): VocabularySnapshot => ({
    statuses,
    forms,
    words: new Set(Object.keys(statuses).filter((word) => {
        const status = statuses[word];
        return status === 'learning' || status === 'familiar';
    })),
});

describe('transcript vocabulary counts', () => {
    it('counts visible annotations per occurrence, not per unique word', () => {
        const sentence = sentenceOf({ text: 'run run walk' });
        const snapshot = snapshotOf({ run: 'learning', walk: 'familiar' });

        const count = countSentenceVocabulary(
            sentence,
            (word, lemma) => resolveStatusFromSnapshot(snapshot, word, lemma),
            'coach',
        );

        expect(count).toEqual({ learning: 2, familiar: 1 });
    });

    it('uses the NLP lemma when present so inflections resolve to the same word', () => {
        const sentence = sentenceOf({
            text: 'running',
            struct: {
                original: 'running',
                blocks: [{ blockParts: [{ content: 'running', implicit: 'running', lemma: 'run', isWord: true }] }],
            },
        });
        const snapshot = snapshotOf({ run: 'learning' });

        const count = countSentenceVocabulary(
            sentence,
            (word, lemma) => resolveStatusFromSnapshot(snapshot, word, lemma),
            'calm',
        );

        expect(count.learning).toBe(1);
    });

    it('falls back to variant forms when the surface form is not in the vocabulary', () => {
        const snapshot = snapshotOf({ run: 'learning' }, { running: 'run' });

        expect(resolveStatusFromSnapshot(snapshot, 'running')).toBe('learning');
    });

    it('ignores known and ignored words, matching what the transcript paints', () => {
        const sentence = sentenceOf({ text: 'alpha beta' });
        const snapshot = snapshotOf({ alpha: 'known', beta: 'ignored' });

        const count = countSentenceVocabulary(
            sentence,
            (word, lemma) => resolveStatusFromSnapshot(snapshot, word, lemma),
            'intensive',
        );

        expect(count).toEqual(EMPTY_SENTENCE_VOCABULARY_COUNT);
    });

    it('does not count familiar words when guidance is calm', () => {
        const sentence = sentenceOf({ text: 'alpha beta' });
        const snapshot = snapshotOf({ alpha: 'learning', beta: 'familiar' });

        const count = countSentenceVocabulary(
            sentence,
            (word, lemma) => resolveStatusFromSnapshot(snapshot, word, lemma),
            'calm',
        );

        expect(count).toEqual({ learning: 1, familiar: 0 });
    });
});

describe('transcript vocabulary filtering', () => {
    const sentences = [
        sentenceOf({ index: 1, text: 'alpha one' }),
        sentenceOf({ index: 2, text: 'beta two' }),
        sentenceOf({ index: 3, text: 'gamma three' }),
    ];
    const snapshot = snapshotOf({ alpha: 'learning', beta: 'familiar' });
    const countOf = (sentence: Sentence) =>
        countSentenceVocabulary(
            sentence,
            (word, lemma) => resolveStatusFromSnapshot(snapshot, word, lemma),
            'coach',
        );

    it('returns the original list for the all filter', () => {
        expect(filterTranscriptSentences(sentences, 'all', countOf)).toBe(sentences);
    });

    it('keeps only sentences that contain the selected annotation', () => {
        expect(filterTranscriptSentences(sentences, 'learning', countOf).map((s) => s.index)).toEqual([1]);
        expect(filterTranscriptSentences(sentences, 'familiar', countOf).map((s) => s.index)).toEqual([2]);
    });

    it('always keeps the sentence that is currently playing', () => {
        const kept = filterTranscriptSentences(
            sentences,
            'learning',
            countOf,
            (sentence) => sentence.index === 3,
        );

        expect(kept.map((s) => s.index)).toEqual([1, 3]);
    });

    it('keys sentences the same way the transcript scroll positions do', () => {
        expect(sentenceVocabularyKey(sentences[0])).toBe('hash-1:1');
    });
});
