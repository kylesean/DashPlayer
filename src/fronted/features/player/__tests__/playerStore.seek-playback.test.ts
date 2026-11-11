import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayer } from '@/fronted/features/player/playerStore';
import type { Sentence } from '@/common/types/SentenceC';

// playerStore 在模块加载时会拉取设置与窗口信息；这里只关心 seek 对播放意图的影响，
// 把外部 IPC 与音频能力全部替身掉，避免测试依赖真实后端。
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

/**
 * 构造两句连续字幕，用于验证导航后的播放态。
 *
 * @returns 供 loadSubtitles 使用的句子数组。
 */
const sentences = (): Sentence[] => ([
    { key: 'h-0', index: 0, fileHash: 'h', text: 'first', start: 0, end: 1 },
    { key: 'h-1', index: 1, fileHash: 'h', text: 'second', start: 1, end: 2 },
] as unknown as Sentence[]);

/** 把播放器摆到「已加载字幕 + 指定播放态 + 第一句」的基线。 */
const arrange = (playing: boolean): void => {
    usePlayer.setState({ playing: false });
    usePlayer.getState().loadSubtitles(sentences());
    usePlayer.setState({ currentSentence: sentences()[0], playing });
};

describe('playerStore seek 与播放意图', () => {
    beforeEach(() => {
        usePlayer.setState({
            playing: false,
            autoPause: false,
            singleRepeat: false,
            shadowing: false,
            hoverRepeat: false,
            sentenceLoop: null,
            playbackRate: 1,
            seekTime: { time: 0 },
        });
    });

    it('暂停中跳到下一句不会起播', () => {
        arrange(false);

        usePlayer.getState().nextSentence();

        expect(usePlayer.getState().playing).toBe(false);
    });

    it('播放中跳到下一句保持播放', () => {
        arrange(true);

        usePlayer.getState().nextSentence();

        expect(usePlayer.getState().playing).toBe(true);
    });

    it('暂停中跳到上一句不会起播', () => {
        arrange(false);
        usePlayer.setState({ currentSentence: sentences()[1] });

        usePlayer.getState().prevSentence();

        expect(usePlayer.getState().playing).toBe(false);
    });

    it('暂停中拖动进度条不会起播', () => {
        arrange(false);

        usePlayer.getState().seekTo({ time: 1.5 });

        expect(usePlayer.getState().playing).toBe(false);
    });

    it('显式 play: true 的 seek 会起播（首次加载定位上次进度）', () => {
        arrange(false);

        usePlayer.getState().seekTo({ time: 1.5, play: true });

        expect(usePlayer.getState().playing).toBe(true);
    });

    it('暂停中点文稿跳句不会起播', () => {
        arrange(false);

        usePlayer.getState().gotoSentence(sentences()[1]);

        expect(usePlayer.getState().playing).toBe(false);
    });

    it('暂停中微调字幕时间不会起播', () => {
        arrange(false);

        usePlayer.getState().adjustCurrentBegin(0.2);

        expect(usePlayer.getState().playing).toBe(false);
    });

    it('用户主动「重复当前句」仍然是播放动作', () => {
        arrange(false);

        usePlayer.getState().repeatCurrent({ loop: false });

        expect(usePlayer.getState().playing).toBe(true);
    });

    it('超短句单句循环在落点处不反复触发 seek（区间下限守卫）', () => {
        // 40ms 的畸形短句：1x 倍速下句末提前量 0.06s 大于句长本身。
        // 无守卫时循环落点（句首）自身满足 reachedLoopEnd，
        // 每个采样周期都会再发一次 seek——约 20 次/秒的忙循环。
        usePlayer.setState({ playing: true, singleRepeat: true });
        const shortSentence: Sentence = {
            key: 's-0', index: 0, fileHash: 's', text: 'Yes.', start: 0, end: 0.04,
            adjustedStart: null, adjustedEnd: null, textZH: '', transGroup: 1,
            translationKey: 's:0', struct: { original: 'Yes.', blocks: [] },
        };
        usePlayer.getState().loadSubtitles([
            shortSentence,
            { key: 's-1', index: 1, fileHash: 's', text: 'rest', start: 0.04, end: 2, adjustedStart: null, adjustedEnd: null },
        ] as unknown as Sentence[]);
        usePlayer.setState({ currentSentence: shortSentence });

        usePlayer.getState().seekTo({ time: 0 });
        const requestIdBefore = usePlayer.getState().seekTime?.requestId;
        usePlayer.getState().resolveSeek(0, requestIdBefore);

        // 守卫生效：落点处不再判定「已到句末」，不产生新的 seek。
        expect(usePlayer.getState().seekTime?.requestId).toBe(requestIdBefore);
    });

    it('过期的 seek 落点被忽略，新一轮落点正常结算', () => {
        arrange(true);

        usePlayer.getState().seekTo({ time: 1.5 });
        const staleId = usePlayer.getState().seekTime?.requestId;
        usePlayer.getState().seekTo({ time: 1.8 });
        const newId = usePlayer.getState().seekTime?.requestId;
        expect(newId).not.toBe(staleId);

        // 上一次 seek 的 seeked 迟到：不得解除新一轮的时间覆盖。
        usePlayer.getState().resolveSeek(1.5, staleId);
        expect(usePlayer.getState().internal.exactPlayTime).not.toBe(1.5);

        usePlayer.getState().resolveSeek(1.8, newId);
        expect(usePlayer.getState().internal.exactPlayTime).toBe(1.8);
    });
});
