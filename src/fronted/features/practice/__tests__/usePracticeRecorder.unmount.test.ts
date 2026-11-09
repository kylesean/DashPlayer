import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import usePracticePanel from '@/fronted/features/practice/practiceStore';
import { usePracticeRecorder } from '@/fronted/features/practice/usePracticeRecorder';

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/fronted/features/practice/practiceApi', () => ({
    practiceApi: { ensureMicrophone: vi.fn().mockResolvedValue('granted') },
}));

vi.mock('@/fronted/features/player/components/PlayerActions', () => ({
    playerActions: { pause: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

/** 最小可用的 MediaRecorder 替身：只实现 hook 实际用到的成员。 */
class FakeMediaRecorder {
    public static instances: FakeMediaRecorder[] = [];
    public static isTypeSupported(): boolean {
        return true;
    }
    public state: 'inactive' | 'recording' = 'inactive';
    public mimeType = 'audio/webm';
    public ondataavailable: ((event: { data: Blob }) => void) | null = null;
    public onstop: (() => void) | null = null;

    public constructor(_stream: MediaStream) {
        FakeMediaRecorder.instances.push(this);
    }

    public start(): void {
        this.state = 'recording';
    }

    public stop(): void {
        this.state = 'inactive';
        this.onstop?.();
    }
}

describe('跟读录音在面板卸载时的全局状态', () => {
    beforeEach(() => {
        FakeMediaRecorder.instances = [];
        usePracticePanel.setState({ recording: false, visible: true });
        vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                getUserMedia: vi.fn().mockResolvedValue({
                    getTracks: () => [{ stop: vi.fn() }],
                }),
            },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /**
     * jsdom 的 Blob 没有实现 arrayBuffer，而 hook 会把录音字节转成 Uint8Array 交给评分。
     * 这里按真实浏览器语义补一个实现，避免测试因环境缺失而走不到评分分支。
     */
    const installBlobArrayBuffer = (): void => {
        if (typeof Blob.prototype.arrayBuffer === 'function') {
            return;
        }
        Object.defineProperty(Blob.prototype, 'arrayBuffer', {
            configurable: true,
            value(this: Blob): Promise<ArrayBuffer> {
                return Promise.resolve(new ArrayBuffer(this.size));
            },
        });
    };

    it('录音中卸载（关闭面板）后不应残留 recording=true', async () => {
        const { result, unmount } = renderHook(() =>
            usePracticeRecorder({ onRecordingComplete: vi.fn().mockResolvedValue(undefined) }),
        );

        await act(async () => {
            await result.current.start();
        });
        expect(result.current.phase).toBe('recording');
        expect(usePracticePanel.getState().recording).toBe(true);

        // 面板条件卸载：等价于用户录音时点了关闭按钮
        unmount();

        // 全局标志若残留，播放类快捷键会被永久禁用
        expect(usePracticePanel.getState().recording).toBe(false);
    });

    it('录音中切到听写模式时，麦克风应停止且 recording 归位', async () => {
        const { result, rerender } = renderHook(
            ({ active }) => {
                // 模拟 PracticePanel 的渲染分支：切到听写后跟读 UI 不再渲染，
                // 但 hook 仍挂载（面板没关闭），因此不会走卸载清理。
                const recorder = usePracticeRecorder({
                    onRecordingComplete: vi.fn().mockResolvedValue(undefined),
                    active,
                });
                return active ? recorder : null;
            },
            { initialProps: { active: true } },
        );

        await act(async () => {
            await result.current!.start();
        });
        expect(result.current!.phase).toBe('recording');
        expect(usePracticePanel.getState().recording).toBe(true);

        // 用户切到「听写」页签：录音按钮整块从 DOM 消失
        rerender({ active: false });

        await waitFor(() => {
            expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
            expect(usePracticePanel.getState().recording).toBe(false);
        });
    });

    it('正常停止录音仍会提交评分，不被 cancel 逻辑误伤', async () => {
        installBlobArrayBuffer();
        const onRecordingComplete = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() =>
            usePracticeRecorder({ onRecordingComplete, active: true }),
        );

        await act(async () => {
            await result.current.start();
        });

        // 模拟 MediaRecorder 在停止前吐出数据
        const recorder = FakeMediaRecorder.instances[0];
        const chunk = new Blob(['audio'], { type: 'audio/webm' });
        recorder.ondataavailable?.({ data: chunk });

        await act(async () => {
            result.current.stop();
        });

        await waitFor(() => expect(onRecordingComplete).toHaveBeenCalledTimes(1));
        expect(result.current.phase).toBe('idle');
        expect(usePracticePanel.getState().recording).toBe(false);
    });

    it('评分进行中（processing）切走不应把阶段打回 idle，否则可并发开启新录音', async () => {
        installBlobArrayBuffer();
        // 评分 Promise 由测试控制何时完成，用来观察 processing 窗口内的状态。
        let releaseScore!: () => void;
        const scorePending = new Promise<void>((resolve) => {
            releaseScore = resolve;
        });
        const onRecordingComplete = vi.fn().mockReturnValue(scorePending);

        const { result, rerender } = renderHook(
            ({ active }) => usePracticeRecorder({ onRecordingComplete, active }),
            { initialProps: { active: true } },
        );

        await act(async () => {
            await result.current.start();
        });
        const recorder = FakeMediaRecorder.instances[0];
        recorder.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });

        await act(async () => {
            result.current.stop();
        });
        await waitFor(() => expect(result.current.phase).toBe('processing'));

        // 评分尚未返回时用户切到听写页签
        rerender({ active: false });
        await act(async () => {
            await Promise.resolve();
        });

        // 阶段必须仍是 processing：若被打回 idle，用户能立刻再点录音，
        // 与仍在进行的评分并发，结果会挂到错误的句子上。
        expect(result.current.phase).toBe('processing');

        await act(async () => {
            releaseScore();
            await scorePending;
        });
        await waitFor(() => expect(result.current.phase).toBe('idle'));
    });

    it('评分进行中卸载组件不应抛错或泄漏 recording 标志', async () => {
        installBlobArrayBuffer();
        let releaseScore!: () => void;
        const scorePending = new Promise<void>((resolve) => {
            releaseScore = resolve;
        });
        const onRecordingComplete = vi.fn().mockReturnValue(scorePending);

        const { result, unmount } = renderHook(() =>
            usePracticeRecorder({ onRecordingComplete }),
        );

        await act(async () => {
            await result.current.start();
        });
        const recorder = FakeMediaRecorder.instances[0];
        recorder.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
        await act(async () => {
            result.current.stop();
        });
        await waitFor(() => expect(result.current.phase).toBe('processing'));

        // 评分尚未返回时面板被卸载（例如切视频）
        unmount();
        expect(usePracticePanel.getState().recording).toBe(false);

        // 评分稍后返回：已卸载组件上的 setState 不应抛错
        await act(async () => {
            releaseScore();
            await scorePending;
        });
        expect(usePracticePanel.getState().recording).toBe(false);
    });
});
