import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sentence } from '@/common/types/SentenceC';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { PRACTICE_CLIP_TAIL_SECONDS } from '@/fronted/features/player/lib/practice-clip-range';

vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        deleteTimestampAdjustmentByKey: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/fronted/infrastructure/electron/backendClient', () => ({
    backendClient: { call: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const makeSentence = (index: number, start: number, end: number): Sentence => ({
    fileHash: 'hash-clip',
    index,
    start,
    end,
    adjustedStart: null,
    adjustedEnd: null,
    text: `Sentence ${index}`,
    textZH: '',
    key: `hash-clip-${index}`,
    transGroup: 1,
    translationKey: `hash-clip:${index}`,
    struct: { original: `Sentence ${index}`, blocks: [] },
});

describe('playerStore 练习受控区间试听 playPracticeClip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        usePlayer.getState().setSource('file:///test.mp4');
        usePlayer.getState().loadSubtitles([
            makeSentence(0, 1, 3),
            makeSentence(1, 3.5, 6),
        ]);
        usePlayer.setState({ playbackRate: 1.0 });
    });

    it('播放越过句末时自动停在区间终点、不切到下一句，并恢复暂存倍速与触发回调', () => {
        const s0 = usePlayer.getState().sentences[0];
        const onEnded = vi.fn();

        usePlayer.getState().playPracticeClip({ start: 1, end: 3 }, s0, {
            rate: 0.75,
            onEnded,
        });
        expect(usePlayer.getState().playing).toBe(true);
        expect(usePlayer.getState().playbackRate).toBe(0.75);
        expect(usePlayer.getState().currentSentence?.index).toBe(0);

        // seek 落地：媒体真正到达片段起点后才允许按句尾截停
        usePlayer.getState().resolveSeek(1.0);

        // 先模拟一帧仍在 2.2s（进入片段区间，标记 settled）
        usePlayer.getState().updateExactPlayTime(2.2);
        vi.runAllTimers();
        expect(usePlayer.getState().playing).toBe(true);

        // 下一帧超过「句尾 + 留白」：立刻停播、高亮锁回第 0 句、倍速复原 1.0x
        // 留白是练习片段的固有语义（完整句子不能被切尾音），见 practice-clip-range。
        usePlayer.getState().updateExactPlayTime(3.05 + PRACTICE_CLIP_TAIL_SECONDS + 0.01);
        vi.runAllTimers();

        expect(usePlayer.getState().playing).toBe(false);
        expect(usePlayer.getState().currentSentence?.index).toBe(0);
        expect(usePlayer.getState().playbackRate).toBe(1.0);
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('未先进入目标区间的旧播放时间不会误触发提前截停', () => {
        const s0 = usePlayer.getState().sentences[0];
        const onEnded = vi.fn();

        // 假设视频原本停在第 2 句 5.2s
        usePlayer.getState().updateExactPlayTime(5.2);
        usePlayer.getState().playPracticeClip({ start: 1, end: 3 }, s0, { onEnded });

        // 异步 seek 尚未落地前收到的 5.2s 旧帧不应立刻截停
        usePlayer.getState().updateExactPlayTime(5.2);
        vi.runOnlyPendingTimers();
        expect(usePlayer.getState().playing).toBe(true);
        expect(onEnded).not.toHaveBeenCalled();

        // seek 落地进入片段后再到达句尾才正常停下
        usePlayer.getState().resolveSeek(1.05);
        usePlayer.getState().updateExactPlayTime(1.1);
        vi.runOnlyPendingTimers();
        usePlayer.getState().updateExactPlayTime(3.02 + PRACTICE_CLIP_TAIL_SECONDS + 0.01);
        vi.runOnlyPendingTimers();
        expect(usePlayer.getState().playing).toBe(false);
        expect(onEnded).toHaveBeenCalledTimes(1);
    });
});
