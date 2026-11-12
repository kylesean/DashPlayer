import { describe, expect, it } from 'vitest';

import {
    REVIEW_BATCH_SIZE,
    selectReviewBatch,
} from '@/fronted/features/player/components/learning-toolbar/reviewBatch';

const cards = (...words: string[]) => words.map((word) => ({ word }));

describe('review batch grouping', () => {
    it('keeps a batch within the 3–5 cards the plan asks for', () => {
        expect(REVIEW_BATCH_SIZE).toBeGreaterThanOrEqual(3);
        expect(REVIEW_BATCH_SIZE).toBeLessThanOrEqual(5);
    });

    it('starts at the first card with the batch size as total', () => {
        const batch = selectReviewBatch(cards('a', 'b', 'c', 'd', 'e', 'f', 'g'), []);

        expect(batch.card?.word).toBe('a');
        expect(batch.done).toBe(0);
        expect(batch.total).toBe(REVIEW_BATCH_SIZE);
        expect(batch.isComplete).toBe(false);
    });

    it('does not promise a full batch when fewer cards are due', () => {
        const batch = selectReviewBatch(cards('a', 'b'), []);

        expect(batch.total).toBe(2);
        expect(batch.card?.word).toBe('a');
    });

    it('advances to the next pending card without shrinking the total', () => {
        // 服务端评完一张就会把它移出到期列表，因此这里是「已复习 1 张 + 剩余 4 张」。
        const batch = selectReviewBatch(cards('b', 'c', 'd', 'e'), ['a']);

        expect(batch.card?.word).toBe('b');
        expect(batch.done).toBe(1);
        expect(batch.total).toBe(REVIEW_BATCH_SIZE);
    });

    it('reports the batch as complete once the batch size is reached', () => {
        const batch = selectReviewBatch(
            cards('f', 'g'),
            ['a', 'b', 'c', 'd', 'e'],
        );

        expect(batch.card).toBeNull();
        expect(batch.isComplete).toBe(true);
        expect(batch.done).toBe(REVIEW_BATCH_SIZE);
    });

    it('matches reviewed words case-insensitively so a re-cased card is not repeated', () => {
        const batch = selectReviewBatch(cards('Journey', 'other'), ['journey']);

        expect(batch.card?.word).toBe('other');
    });

    it('returns no card when the due queue is empty', () => {
        const batch = selectReviewBatch([], []);

        expect(batch.card).toBeNull();
        expect(batch.isComplete).toBe(false);
    });
});
