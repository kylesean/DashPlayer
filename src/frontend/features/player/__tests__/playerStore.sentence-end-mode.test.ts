import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayer } from '@/frontend/features/player/playerStore';
import { deriveSentenceEndMode } from '@/frontend/features/player/lib/sentence-end-mode';

// playerStore 在模块加载时会拉取设置与窗口信息；这里只关心句末模式的状态转移，
// 把外部 IPC 与音频能力全部替身掉，避免测试依赖真实后端。
vi.mock('@/frontend/features/player/playerApi', () => ({
    playerApi: {
        deleteTimestampAdjustmentByKey: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/frontend/infrastructure/electron/backendClient', () => ({
    backendClient: { call: vi.fn().mockResolvedValue({}) },
}));

vi.mock('@/frontend/log/simple-logger', () => ({
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

    it('UI 派生模式与 store 实际生效的字段一致（脏状态下也成立）', () => {
        // 这条钉的是「两个文件之间的顺序对齐」：`deriveSentenceEndMode` 的裁决顺序
        // 必须与 `onTimeUpdate` 的分支顺序一致，否则 UI 会显示一个引擎不执行的模式。
        //
        // 正常路径（互斥由 setter 保证）逐个验证：
        const cases: Array<[() => void, string]> = [
            [() => usePlayer.getState().setAutoPause(true), 'autoPause'],
            [() => usePlayer.getState().setSingleRepeat(true), 'singleRepeat'],
            [() => usePlayer.getState().setShadowing(true), 'shadowing'],
            [() => usePlayer.getState().setSentenceLoop({ times: 3 }), 'sentenceLoop'],
        ];
        for (const [activate, expected] of cases) {
            usePlayer.setState({
                autoPause: false,
                singleRepeat: false,
                shadowing: false,
                sentenceLoop: null,
            });
            activate();
            const s = usePlayer.getState();
            expect(
                deriveSentenceEndMode(
                    { autoPause: s.autoPause, singleRepeat: s.singleRepeat, shadowing: s.shadowing },
                    s.sentenceLoop !== null,
                ),
                expected,
            ).toBe(expected);
        }

        // 脏状态（绕过 setter 直接写字段）：引擎会先命中 autoPause 分支，UI 必须同样显示 autoPause
        usePlayer.setState({ autoPause: true, singleRepeat: true, shadowing: true, sentenceLoop: null });
        const dirty = usePlayer.getState();
        expect(
            deriveSentenceEndMode(
                { autoPause: dirty.autoPause, singleRepeat: dirty.singleRepeat, shadowing: dirty.shadowing },
                dirty.sentenceLoop !== null,
            ),
        ).toBe('autoPause');
    });
});
