import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDownloadProgressTracker } from '../downloadProgressTracker';

describe('createDownloadProgressTracker（EMA 网速与快照内核）', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('首个采样只建基线（speed 0），第二个采样取瞬时值并算出 percent', () => {
        const tracker = createDownloadProgressTracker(0.25);
        vi.setSystemTime(11_000); // 1s 内下载了 6000 字节
        tracker.track(6000, 10_000);
        expect(tracker.getSnapshot().speed).toBe(0); // 原语义：无前基线不产速度

        vi.setSystemTime(12_000);
        tracker.track(14_000, 10_000); // 瞬时 8000
        const snap = tracker.getSnapshot();
        expect(snap.speed).toBe(8000);
        expect(snap.percent).toBe(100);
        expect(snap.downloaded).toBe(14_000);
    });

    it('第三个采样起走 EMA：speed = 旧值*(1-s) + 瞬时*s', () => {
        const tracker = createDownloadProgressTracker(0.25);
        vi.setSystemTime(11_000);
        tracker.track(6000, 10_000); // 建基线，speed 0
        vi.setSystemTime(12_000);
        tracker.track(14_000, 10_000); // speed===0 → 直接取瞬时 8000
        vi.setSystemTime(13_000);
        tracker.track(20_000, 10_000); // instant 6000 → 8000*0.75 + 6000*0.25 = 7500
        expect(tracker.getSnapshot().speed).toBe(7500);
    });

    it('字节回退的采样只更新基线，不产生虚假速度', () => {
        const tracker = createDownloadProgressTracker(0.25);
        vi.setSystemTime(11_000);
        tracker.track(6000, 10_000);
        vi.setSystemTime(12_000);
        tracker.track(14_000, 10_000);
        const speedBefore = tracker.getSnapshot().speed;
        vi.setSystemTime(13_000);
        tracker.track(5000, 10_000); // 回退：忽略速度计算
        expect(tracker.getSnapshot().speed).toBe(speedBefore);
        expect(tracker.getSnapshot().downloaded).toBe(5000);
    });

    it('total 为 0 时 percent 为 0 且不除零', () => {
        const tracker = createDownloadProgressTracker(0.25);
        vi.setSystemTime(11_000);
        tracker.track(100, 0);
        vi.setSystemTime(12_000);
        tracker.track(300, 0);
        expect(tracker.getSnapshot().percent).toBe(0);
    });

    it('reset 复位快照与网速基线：重开下载后重新走「基线→瞬时」序列', () => {
        const tracker = createDownloadProgressTracker(0.25);
        vi.setSystemTime(11_000);
        tracker.track(6000, 10_000);
        vi.setSystemTime(12_000);
        tracker.track(14_000, 10_000); // speed 8000
        tracker.reset(20_000);
        expect(tracker.getSnapshot()).toEqual({ percent: 0, downloaded: 0, total: 20_000, speed: 0 });

        vi.setSystemTime(13_000);
        tracker.track(3000, 20_000); // 基线重建：speed 0
        expect(tracker.getSnapshot().speed).toBe(0);
        vi.setSystemTime(14_000);
        tracker.track(9000, 20_000); // instant 6000
        expect(tracker.getSnapshot().speed).toBe(6000);
    });
});
