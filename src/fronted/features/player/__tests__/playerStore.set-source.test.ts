import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayer } from '@/fronted/features/player/playerStore';
import type { Sentence } from '@/common/types/SentenceC';

// 与 seek-playback 测试同一套替身：playerStore 模块加载时会拉取设置与窗口信息，
// 这里只关心换源对 seek 契约与瞬态状态的影响，把外部 IPC 全部替身掉。
vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        deleteTimestampAdjustmentByKey: vi.fn().mockResolvedValue(undefined),
        updateTimestampAdjustment: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/fronted/infrastructure/electron/backendClient', () => ({
    backendClient: { call: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** 构造一个最小可用字幕句。 */
const sentenceAt = (start: number, end: number): Sentence => ({
    key: `h-${start}`, index: start, fileHash: 'h', text: 'line', start, end,
    adjustedStart: null, adjustedEnd: null,
} as unknown as Sentence);

describe('playerStore setSource 换源契约', () => {
    beforeEach(() => {
        usePlayer.setState({
            src: 'file:///tmp/a.mp4',
            playing: true,
            duration: 600,
            autoPause: false,
            singleRepeat: false,
            shadowing: false,
            hoverRepeat: false,
            sentenceLoop: null,
            playbackRate: 1,
            currentSentence: sentenceAt(0, 2),
            seekTime: { time: 0 },
            internal: {
                exactPlayTime: 0,
                onPlaySeekTime: null,
                seekInFlight: false,
                tailPreview: null,
                timeOverride: null,
                currentLock: null,
                transientPlan: null,
                indexing: null,
            },
        });
    });

    it('换源清空在途 seek 契约、瞬态计划与高亮锁', () => {
        usePlayer.getState().loadSubtitles([sentenceAt(0, 2), sentenceAt(2, 4)]);
        usePlayer.getState().seekTo({ time: 1.5 });

        expect(usePlayer.getState().internal.seekInFlight).toBe(true);
        expect(usePlayer.getState().seekTime?.requestId).toBeDefined();

        usePlayer.getState().setSource('file:///tmp/b.mp4');

        expect(usePlayer.getState().src).toBe('file:///tmp/b.mp4');
        expect(usePlayer.getState().playing).toBe(false);
        expect(usePlayer.getState().seekTime).toEqual({ time: 0 });
        expect(usePlayer.getState().internal.seekInFlight).toBe(false);
        expect(usePlayer.getState().internal.exactPlayTime).toBe(0);
        expect(usePlayer.getState().internal.currentLock).toBeNull();
        expect(usePlayer.getState().internal.transientPlan).toBeNull();
        expect(usePlayer.getState().internal.tailPreview).toBeNull();
        expect(usePlayer.getState().internal.timeOverride).toBeNull();
    });

    it('换源后旧视频的迟到结算被拒绝，不把旧落点写进新源', () => {
        usePlayer.getState().seekTo({ time: 1.5 });
        const staleId = usePlayer.getState().seekTime?.requestId;

        usePlayer.getState().setSource('file:///tmp/b.mp4');

        // 旧源在途 seek 的兜底/卸载结算迟到：契约已被 setSource 清空，必须整单拒绝
        usePlayer.getState().resolveSeek(120, staleId);

        expect(usePlayer.getState().internal.exactPlayTime).toBe(0);
    });

    it('无序号的落点结算仍被接受（元素上报时间的通道不收窄）', () => {
        usePlayer.getState().setSource('file:///tmp/b.mp4');

        usePlayer.getState().resolveSeek(0);

        expect(usePlayer.getState().internal.exactPlayTime).toBe(0);
        expect(usePlayer.getState().internal.seekInFlight).toBe(false);
    });

    it('新一轮 seek 的落点结算不受影响（门控只针对失配序号）', () => {
        usePlayer.getState().seekTo({ time: 1.5 });
        const id = usePlayer.getState().seekTime?.requestId;

        usePlayer.getState().resolveSeek(1.5, id);

        expect(usePlayer.getState().internal.exactPlayTime).toBe(1.5);
        expect(usePlayer.getState().internal.seekInFlight).toBe(false);
    });
});
