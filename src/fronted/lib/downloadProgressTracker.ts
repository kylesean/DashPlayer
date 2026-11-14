/**
 * 下载进度的非响应式跟踪内核：EMA 网速平滑 + 瞬时快照。
 *
 * 为什么值得单独成模块：onboarding 引导下载与设置页资源包下载曾各自内联同一份
 * EMA 公式（约 15 行逐 token 相同），且调参已各自漂移——算法统一为一份、平滑系数
 * 由调用方传入，漂移收敛为「同一算法的两个调参档」。
 *
 * 定位与 zustand 的关系：本跟踪器是纯内存计算，**刻意不走响应式状态**——进度事件
 * 频率高（字节级）而 UI 只需按各自的渲染间隔节流取快照。调用方负责把
 * {@link DownloadProgressTracker.getSnapshot} 的结果按自己的节奏刷进状态容器
 * （onboarding 用 hook state + setInterval，设置页用 useSyncExternalStore 外部 store）。
 */

export interface DownloadLiveSnapshot {
    /** 已完成的百分比（0~100 整数，向下取整）。 */
    percent: number;
    downloaded: number;
    total: number;
    /** 平滑后的网速（字节/秒）；首个有效采样前为 0。 */
    speed: number;
}

interface ProgressSample {
    at: number;
    downloaded: number;
}

/**
 * 创建一个进度跟踪器。
 *
 * @param smoothing EMA 平滑系数（0~1）：越大越跟手、越小越平滑。
 *   引导页 0.3（要求快速响应），设置页 0.25（长下载偏稳重）。
 */
export function createDownloadProgressTracker(smoothing: number) {
    let sample: ProgressSample | null = null;
    let snapshot: DownloadLiveSnapshot = { percent: 0, downloaded: 0, total: 0, speed: 0 };

    return {
        /**
         * 喂入一次字节进度，更新快照与平滑网速。
         * 时间戳倒退或字节数回退的采样会被忽略（只更新采样点，不产生虚假速度）。
         */
        track(downloaded: number, total: number): void {
            const now = Date.now();
            let speed = snapshot.speed;
            if (sample && now > sample.at && downloaded >= sample.downloaded) {
                const instant = ((downloaded - sample.downloaded) * 1000) / (now - sample.at);
                speed = speed === 0 ? instant : speed * (1 - smoothing) + instant * smoothing;
            }
            sample = { at: now, downloaded };
            snapshot = {
                percent: total > 0 ? Math.min(100, Math.floor((downloaded / total) * 100)) : 0,
                downloaded,
                total,
                speed,
            };
        },

        /** 当前快照（只读意图：调用方应浅拷贝后再写入状态容器）。 */
        getSnapshot(): DownloadLiveSnapshot {
            return snapshot;
        },

        /** 复位到零值（新一轮下载开始时调用，同时重置网速采样基线）。 */
        reset(initialTotal = 0): void {
            sample = null;
            snapshot = { percent: 0, downloaded: 0, total: initialTotal, speed: 0 };
        },
    };
}

export type DownloadProgressTracker = ReturnType<typeof createDownloadProgressTracker>;
