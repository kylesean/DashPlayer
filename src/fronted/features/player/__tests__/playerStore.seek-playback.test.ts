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
});
