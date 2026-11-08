/**
 * 计算打开媒体时的续播起始时间；接近片尾时从头播放。
 *
 * @param opts 当前已保存的进度与总时长（秒）。
 * @returns 推荐续播位置（秒）。
 */
export function computeResumeTime(opts: { progress: number; duration: number }): number {
    const progress = Number.isFinite(opts.progress) ? opts.progress : 0;
    const duration = Number.isFinite(opts.duration) ? opts.duration : 0;
    if (progress <= 0 || duration <= 0) return Math.max(0, progress);

    const remaining = duration - progress;
    const nearEndThresholdSeconds = Math.min(15, Math.max(3, duration * 0.05));
    if (remaining <= nearEndThresholdSeconds) {
        return 0;
    }
    return Math.max(0, Math.min(progress, duration));
}
