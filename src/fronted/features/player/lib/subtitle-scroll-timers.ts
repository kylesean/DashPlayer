import type { ScrollState } from '@/fronted/features/player/hooks/useSubtitleScroll';

/**
 * 定时器到目标状态的映射。
 *
 * `RESTORE` 表示「还原定时器启动前的状态」，用于模式切换期间的测量冻结：
 * 冻结不是进入某个固定状态，而是把状态暂停后再放回去。
 */
export type ScrollTimerTarget = ScrollState | 'RESTORE';

export interface ScrollTimerSpec {
    /** 延时（毫秒）。 */
    readonly delay: number;
    /** 到期后落到的状态。 */
    readonly target: ScrollTimerTarget;
    /** 这条计时为什么存在；改动时长时先读这里。 */
    readonly purpose: string;
}

/**
 * 字幕滚动状态机的全部计时。
 *
 * 此前这 5 个时长是散落在文件各处的魔法数字，只能靠读 `setTimeout` 附近的注释
 * 才知道哪个数字对应哪个状态。这里把「时长 → 目标状态 → 为什么」放在一处：
 * 调时长的人能立刻看到它影响的是哪个状态，而不是只看得到一个孤立的数字。
 */
export const SCROLL_TIMERS = {
    /** 用户浏览态下，当前句回到边界内后恢复跟读。 */
    RESUME_NORMAL: {
        delay: 150,
        target: 'NORMAL',
        purpose: '浏览态下当前句回到安全边界内，恢复自动跟读',
    },
    /** 自动滚动结束后回归 NORMAL 的沉降。 */
    AUTO_SETTLE: {
        delay: 300,
        target: 'NORMAL',
        purpose: '自动滚动动画结束，确认不再有滚动事件后回到跟读待命',
    },
    /** 底部两阶段编排：等待切句停歇。 */
    PIN_DEBOUNCE: {
        delay: 250,
        target: 'AUTO_SCROLLING',
        purpose: '连按切句停歇后，启动第二阶段「平滑归顶」',
    },
    /** 第二阶段平滑归顶后的沉降。 */
    TOP_SETTLE: {
        delay: 500,
        target: 'NORMAL',
        purpose: '归顶动画结束，回到跟读待命',
    },
    /** 模式切换期间冻结测量。 */
    PAUSE_MEASUREMENT: {
        delay: 500,
        target: 'RESTORE',
        purpose: '卡片/全屏切换的界面跳变期冻结判定，到期还原切换前状态',
    },
} as const satisfies Record<string, ScrollTimerSpec>;

/**
 * 读取某条计时的延时。
 *
 * @param name 计时名称。
 * @returns 延时毫秒数。
 */
export function scrollTimerDelay(name: keyof typeof SCROLL_TIMERS): number {
    return SCROLL_TIMERS[name].delay;
}
