import { describe, expect, it } from 'vitest';

import {
    padPracticeClipRange,
    PRACTICE_CLIP_LEAD_IN_SECONDS,
    PRACTICE_CLIP_TAIL_SECONDS,
} from '../practice-clip-range';

describe('练习片段留白', () => {
    /**
     * 核心约束：跟读/精听拿到的必须是「完整的一句话」。
     * 字幕边界是估算值，贴边起停会切掉首音与尾音。
     */
    it('句首与句尾都向外扩展留白', () => {
        const range = padPracticeClipRange({ start: 10, end: 20 });

        expect(range.start).toBeCloseTo(10 - PRACTICE_CLIP_LEAD_IN_SECONDS, 5);
        expect(range.end).toBeCloseTo(20 + PRACTICE_CLIP_TAIL_SECONDS, 5);
    });

    it('片段起点不会被推成负数', () => {
        const range = padPracticeClipRange({ start: 0.05, end: 3 });

        expect(range.start).toBe(0);
        expect(range.end).toBeGreaterThan(3);
    });

    it('句尾不超过视频总时长', () => {
        const range = padPracticeClipRange({ start: 90, end: 99.9 }, 100);

        expect(range.end).toBe(100);
    });

    it('极短片段加留白后仍保证可播放的最小区间', () => {
        const range = padPracticeClipRange({ start: 5, end: 5.02 });

        expect(range.end - range.start).toBeGreaterThanOrEqual(0.15);
    });

    it('总时长未知时只做扩展，不做上限钳制', () => {
        const range = padPracticeClipRange({ start: 1, end: 2 });

        expect(range.end).toBeCloseTo(2 + PRACTICE_CLIP_TAIL_SECONDS, 5);
    });
});
