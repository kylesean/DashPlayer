import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    practiceWordScore,
    recordPracticeWordEvidence,
} from '@/fronted/features/practice/practiceWordEvidence';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { revalidateReviewQueue } from '@/fronted/features/video-learning/reviewQueue';
import type { SentencePracticeResultVO } from '@/common/contracts/sentence-practice';

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        recordWordEncounter: vi.fn(async () => undefined),
    },
}));

vi.mock('@/fronted/features/video-learning/reviewQueue', () => ({
    revalidateReviewQueue: vi.fn(),
}));

const result: SentencePracticeResultVO = {
    score: 83,
    transcript: 'the journey starts',
    audioPath: null,
    words: [
        { expected: 'the', heard: 'the', status: 'match' },
        { expected: 'journey', heard: 'journay', status: 'sub', similarity: 0.86 },
        { expected: 'starts', heard: null, status: 'missing' },
        { expected: 'today', heard: 'today', status: 'extra' },
    ],
};

describe('practiceWordEvidence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('把 match / sub / missing 映射为 0-100 证据分，extra 不参与', () => {
        expect(practiceWordScore({ expected: 'a', heard: 'a', status: 'match' })).toBe(100);
        expect(practiceWordScore({ expected: 'a', heard: 'b', status: 'sub', similarity: 0.86 })).toBe(86);
        expect(practiceWordScore({ expected: 'a', heard: null, status: 'missing' })).toBe(0);
        expect(practiceWordScore({ expected: 'a', heard: 'b', status: 'extra' })).toBeNull();
    });

    it('按逐词结果写入跟读证据，并刷新复习队列', async () => {
        recordPracticeWordEvidence(result, 'shadowing', {
            fileHash: 'file-1',
            sentenceIndex: 4,
            sentenceHash: 'sentence-4',
            text: 'The journey starts.',
        });

        await new Promise((resolve) => { setTimeout(resolve, 0); });

        expect(videoLearningApi.recordWordEncounter).toHaveBeenCalledTimes(3);
        expect(videoLearningApi.recordWordEncounter).toHaveBeenCalledWith(expect.objectContaining({
            word: 'journey',
            action: 'shadow',
            score: 86,
            fileHash: 'file-1',
            sentenceIndex: 4,
            sentenceHash: 'sentence-4',
            context: 'The journey starts.',
        }));
        expect(videoLearningApi.recordWordEncounter).not.toHaveBeenCalledWith(
            expect.objectContaining({ word: 'today' }),
        );
        expect(revalidateReviewQueue).toHaveBeenCalledTimes(1);
    });
});
