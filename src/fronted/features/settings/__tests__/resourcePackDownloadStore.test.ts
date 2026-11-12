import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    cancelPackDownload,
    getPackDownloadState,
    resetPackDownloadStateForTests,
    startPackDownload,
    updatePackCallbacks,
    type PackDownloadEntry,
} from '@/fronted/features/settings/resourcePackDownloadStore';

let progressListener: ((detail: { phase: string; downloaded: number; total: number }) => void) | null = null;

vi.mock('@/fronted/features/settings/settingsEvents', () => ({
    subscribeArchiveDownloadProgress: (listener: typeof progressListener) => {
        progressListener = listener;
        return () => {
            if (progressListener === listener) {
                progressListener = null;
            }
        };
    },
}));

describe('resourcePackDownloadStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPackDownloadStateForTests();
        progressListener = null;
    });

    afterEach(() => {
        resetPackDownloadStateForTests();
        vi.useRealTimers();
    });

    it('在调用方卸载后仍保持队列运行，重新订阅可恢复实时进度并在完成后清理状态', async () => {
        let releaseFirst!: () => void;
        let releaseSecond!: () => void;
        const entry1: PackDownloadEntry = {
            key: 'dict',
            download: vi.fn(() => new Promise<void>((resolve) => { releaseFirst = resolve; })),
            cancel: vi.fn(async () => undefined),
        };
        const entry2: PackDownloadEntry = {
            key: 'tts',
            download: vi.fn(() => new Promise<void>((resolve) => { releaseSecond = resolve; })),
            cancel: vi.fn(async () => undefined),
        };

        const onRefresh1 = vi.fn();
        const onComplete1 = vi.fn();
        const runPromise = startPackDownload({
            packId: 'pack-a',
            entries: [entry1, entry2],
            onRefresh: onRefresh1,
            onComplete: onComplete1,
        });

        expect(getPackDownloadState('pack-a').downloading).toBe(true);
        expect(getPackDownloadState('pack-a').activeItemKey).toBe('dict');

        // 并发再次点击开始会被互斥拒绝
        await startPackDownload({ packId: 'pack-a', entries: [entry1] });
        expect(entry1.download).toHaveBeenCalledTimes(1);

        // 推送下载进度并模拟定时器节流刷新
        progressListener?.({ phase: 'downloading', downloaded: 50, total: 100 });
        vi.advanceTimersByTime(250);
        expect(getPackDownloadState('pack-a').live.percent).toBe(50);

        // 模拟组件重挂载替换回调
        const onRefresh2 = vi.fn();
        const onComplete2 = vi.fn();
        updatePackCallbacks('pack-a', { onRefresh: onRefresh2, onComplete: onComplete2 });

        releaseFirst();
        await vi.advanceTimersByTimeAsync(0);
        expect(getPackDownloadState('pack-a').packProgress.completed).toBe(1);
        expect(getPackDownloadState('pack-a').activeItemKey).toBe('tts');

        releaseSecond();
        await runPromise;

        expect(getPackDownloadState('pack-a').downloading).toBe(false);
        expect(onComplete1).not.toHaveBeenCalled();
        expect(onComplete2).toHaveBeenCalledTimes(1);
        expect(onRefresh2).toHaveBeenCalled();
    });

    it('cancelPackDownload 会中止当前条目且不触发后续条目或 onComplete', async () => {
        let releaseFirst!: () => void;
        const cancelFirst = vi.fn(async () => undefined);
        const entry1: PackDownloadEntry = {
            key: 'dict',
            download: vi.fn(() => new Promise<void>((resolve) => { releaseFirst = resolve; })),
            cancel: cancelFirst,
        };
        const entry2: PackDownloadEntry = {
            key: 'tts',
            download: vi.fn(async () => undefined),
            cancel: vi.fn(async () => undefined),
        };
        const onComplete = vi.fn();

        const runPromise = startPackDownload({
            packId: 'pack-b',
            entries: [entry1, entry2],
            onComplete,
        });

        await cancelPackDownload('pack-b');
        expect(cancelFirst).toHaveBeenCalledTimes(1);

        releaseFirst();
        await runPromise;

        expect(entry2.download).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(getPackDownloadState('pack-b').downloading).toBe(false);
    });
});
