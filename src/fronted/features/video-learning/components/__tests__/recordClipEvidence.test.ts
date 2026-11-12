import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordWordEncounter = vi.fn();

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        recordWordEncounter: (...args: unknown[]) => recordWordEncounter(...args),
    },
}));

import { recordClipEvidence } from '../VideoPlayerPane';

const clip = { videoName: 'journey.mp4' };
const vocabulary = [
    { word: 'journey', matchedForms: ['journeys'] },
    { word: 'resilient', matchedForms: ['resilient'] },
];

describe('recordClipEvidence', () => {
    beforeEach(() => {
        recordWordEncounter.mockReset();
        recordWordEncounter.mockResolvedValue(undefined);
    });

    /**
     * 片段此前完全不参与学习闭环：用户在这里看了、重听了，系统一无所知。
     * 这里锁定「用实际词形上报」，否则屈折形式会被记成另一个词。
     */
    it('按片段里实际命中的词形逐词上报', () => {
        recordClipEvidence(clip, vocabulary, 'seen');

        expect(recordWordEncounter).toHaveBeenCalledTimes(2);
        expect(recordWordEncounter).toHaveBeenCalledWith(expect.objectContaining({
            word: 'journeys',
            action: 'seen',
        }));
        expect(recordWordEncounter).toHaveBeenCalledWith(expect.objectContaining({
            word: 'resilient',
            action: 'seen',
        }));
    });

    it('播完记 replay，与进入时的 seen 区分', () => {
        recordClipEvidence(clip, vocabulary, 'replay');

        expect(recordWordEncounter).toHaveBeenCalledWith(expect.objectContaining({
            word: 'journeys',
            action: 'replay',
        }));
    });

    /**
     * 上报失败只影响证据，不能把播放打断：这里让全部请求 reject，
     * 断言不抛出（未捕获的 rejection 会让测试进程报错）。
     */
    it('上报失败不抛出，不影响播放', async () => {
        recordWordEncounter.mockRejectedValue(new Error('offline'));

        expect(() => recordClipEvidence(clip, vocabulary, 'seen')).not.toThrow();
        await Promise.resolve();
    });
});
