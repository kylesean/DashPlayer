import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayer } from '@/fronted/features/player/playerStore';

// playerStore 在模块加载时会拉取设置与窗口信息；这里只关心句末模式的状态转移，
// 把外部 IPC 与音频能力全部替身掉，避免测试依赖真实后端。
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

/** 读取当前句末模式的四个字段快照。 */
const snapshot = () => {
    const s = usePlayer.getState();
    return {
        autoPause: s.autoPause,
        singleRepeat: s.singleRepeat,
        shadowing: s.shadowing,
        sentenceLoop: s.sentenceLoop !== null,
    };
};

/** 当前同时启用的模式数量，用于断言互斥不变量。 */
const enabledCount = (): number => {
    const s = snapshot();
    return [s.autoPause, s.singleRepeat, s.shadowing, s.sentenceLoop].filter(Boolean).length;
};

describe('playerStore 句末模式互斥', () => {
    beforeEach(() => {
        usePlayer.setState({
            autoPause: false,
            singleRepeat: false,
            shadowing: false,
            hoverRepeat: false,
            sentenceLoop: null,
            playbackRate: 1,
        });
    });

    it('开启自动暂停会关闭单句循环与影子跟读', () => {
        usePlayer.getState().setSingleRepeat(true);
        usePlayer.getState().setAutoPause(true);

        expect(snapshot()).toEqual({
            autoPause: true,
            singleRepeat: false,
            shadowing: false,
            sentenceLoop: false,
        });
        expect(enabledCount()).toBe(1);
    });

    it('开启影子跟读会关闭自动暂停与单句循环', () => {
        usePlayer.getState().setAutoPause(true);
        usePlayer.getState().setShadowing(true);

        expect(snapshot()).toEqual({
            autoPause: false,
            singleRepeat: false,
            shadowing: true,
            sentenceLoop: false,
        });
        expect(enabledCount()).toBe(1);
    });

    it('开启逐句循环会关闭全部布尔模式', () => {
        usePlayer.getState().setSingleRepeat(true);
        usePlayer.getState().setSentenceLoop({ times: 3 });

        expect(snapshot()).toEqual({
            autoPause: false,
            singleRepeat: false,
            shadowing: false,
            sentenceLoop: true,
        });
        expect(enabledCount()).toBe(1);
    });

    it('切换持久模式会取消悬停临时循环（显式选择优先）', () => {
        usePlayer.getState().setHoverRepeat(true);
        expect(usePlayer.getState().hoverRepeat).toBe(true);

        usePlayer.getState().setAutoPause(true);
        expect(usePlayer.getState().hoverRepeat).toBe(false);
    });

    it('repeatCurrent 的单句循环分支同样遵守互斥', () => {
        usePlayer.getState().setShadowing(true);
        // loop 分支过去直接 set({ singleRepeat: true })，会与影子跟读并存
        usePlayer.getState().repeatCurrent({ loop: true });

        expect(snapshot()).toEqual({
            autoPause: false,
            singleRepeat: true,
            shadowing: false,
            sentenceLoop: false,
        });
        expect(enabledCount()).toBe(1);
    });

    it('关闭某个模式不会顺手打开别的模式', () => {
        usePlayer.getState().setAutoPause(true);
        usePlayer.getState().setAutoPause(false);

        expect(enabledCount()).toBe(0);
    });
});
