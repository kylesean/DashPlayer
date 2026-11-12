/**
 * 练习片段（跟读 / 精听循环）的播放区间计算。
 *
 * 核心约束：**片段必须包含「完整的一句话」**，而不是紧贴字幕边界。
 *
 * 字幕边界是估算值——滚动字幕的 cue 起点常比真实开口略晚，词时间又是按音节
 * 比例插值的。贴边起停会吃掉首音、切掉尾音，用户听到「半截开头 + 被掐断的结尾」，
 * 跟读无从模仿、精听无法进入状态。
 *
 * 这里只放宽**播放**区间，不改字幕行自身的 `start` / `end`：高亮仍按原边界走，
 * 避免留白期间高亮提前跳到上一句。
 */

/**
 * 句首留白（秒）。
 *
 * 120ms 足够覆盖常见的起始辅音与气口（`the`、`s`、`f`），又不会把上一句的尾音拖进来。
 */
export const PRACTICE_CLIP_LEAD_IN_SECONDS = 0.12;

/**
 * 句尾留白（秒）。
 *
 * 200ms 比句首长一点：英文句末的摩擦音、爆破音与降调需要时间收尾，
 * 切太快听起来像被掐断。
 */
export const PRACTICE_CLIP_TAIL_SECONDS = 0.2;

/**
 * 给练习片段边界加首尾留白。
 *
 * @param range 原始片段区间（秒）。
 * @param duration 视频总时长（秒）；未知时传 0，只保证不出现负起点。
 * @returns 加过留白的区间。
 */
export function padPracticeClipRange(
    range: { start: number; end: number },
    duration = 0,
): { start: number; end: number } {
    const start = Math.max(0, range.start - PRACTICE_CLIP_LEAD_IN_SECONDS);
    const rawEnd = range.end + PRACTICE_CLIP_TAIL_SECONDS;
    const end = duration > 0 ? Math.min(duration, rawEnd) : rawEnd;
    // 极短片段（<150ms）加留白后仍要保证可播放，沿用既有的最小区间口径。
    return { start, end: Math.max(start + 0.15, end) };
}
