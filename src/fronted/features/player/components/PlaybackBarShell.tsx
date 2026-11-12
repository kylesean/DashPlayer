import type { MouseEventHandler, ReactNode } from 'react';
import { cn } from '@/fronted/lib/utils';

export type PlaybackBarTone = 'inline' | 'overlay';

/**
 * 两种宿主进入单行布局的容器宽度不同。
 *
 * 全屏条多出训练、字幕轨道、设置三组学习工具；760px 时进度条会被挤成 0。
 * 普通条没有这组工具，过早折成双行反而浪费高度。
 */
const SINGLE_ROW_CLASSES = {
    inline: {
        gap: '@[760px]:gap-x-2.5',
        leading: '@[760px]:row-start-1',
        progress: '@[760px]:col-span-1 @[760px]:col-start-2',
        trailing: '@[760px]:row-start-1 @[760px]:gap-2',
    },
    overlay: {
        gap: '@[1000px]:gap-x-3',
        leading: '@[1000px]:row-start-1',
        progress: '@[1000px]:col-span-1 @[1000px]:col-start-2',
        trailing: '@[1000px]:row-start-1 @[1000px]:gap-2',
    },
} as const;

export interface PlaybackBarShellProps {
    /** 窗口内控制条或全屏浮层控制条。 */
    tone: PlaybackBarTone;
    /** 是否处于可交互的显形状态。 */
    visible: boolean;
    /** 遮挡贴片拖动期间降为半透明替身。 */
    ghost?: boolean;
    /** 左侧播放导航与时间。 */
    leading: ReactNode;
    /** 进度条；宽面板居中，窄面板独占一行。 */
    progress: ReactNode;
    /** 右侧按钮组。 */
    trailing: ReactNode;
    className?: string;
    onMouseMove?: MouseEventHandler<HTMLDivElement>;
}

/**
 * 播放控制条的共享外壳。
 *
 * 窗口内与全屏控制条共用同一份 DOM 结构和控件顺序：
 * - 普通条宽于 760px、全屏条宽于 1000px：单行，进度条居中；
 * - 面板较窄：双行，进度条在上、播放导航与按钮在下。
 *
 * 用容器查询而不是视口断点：窗口内控制条的实际宽度取决于视频/文稿分栏比例，
 * 1440px 窗口在文稿拉宽后也可能只剩 700px。
 */
export default function PlaybackBarShell({
    tone,
    visible,
    ghost = false,
    leading,
    progress,
    trailing,
    className,
    onMouseMove,
}: PlaybackBarShellProps) {
    const singleRow = SINGLE_ROW_CLASSES[tone];

    return (
        <div
            onMouseMove={onMouseMove}
            className={cn(
                '@container relative z-20 w-full border bg-media-bg/60 text-media-fg/90 shadow-2xl backdrop-blur-md transition-[opacity,transform] duration-200 ease-out',
                tone === 'inline'
                    ? 'rounded-2xl border-media-fg/15 px-2 py-3 @[760px]:px-4'
                    : 'max-w-7xl rounded-2xl border-media-fg/15 px-3.5 py-1.5',
                ghost
                    ? 'pointer-events-none opacity-40'
                    : visible
                    ? 'pointer-events-auto translate-y-0 opacity-100'
                    : cn('pointer-events-none opacity-0', tone === 'overlay' && 'translate-y-2'),
                className,
            )}
        >
            <div
                className={cn(
                    'grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2',
                    singleRow.gap,
                )}
            >
                <div
                    className={cn(
                        'col-start-1 row-start-2 flex min-w-0 items-center gap-2',
                        singleRow.leading,
                    )}
                >
                    {leading}
                </div>
                <div
                    className={cn(
                        'col-span-3 col-start-1 row-start-1 min-w-0',
                        singleRow.progress,
                    )}
                >
                    {progress}
                </div>
                <div
                    className={cn(
                        'col-start-3 row-start-2 flex min-w-0 items-center justify-end gap-1',
                        singleRow.trailing,
                    )}
                >
                    {trailing}
                </div>
            </div>
        </div>
    );
}
