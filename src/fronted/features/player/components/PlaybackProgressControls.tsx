import { memo, useEffect, useRef, useState } from 'react';
import { Slider } from '@/fronted/components/ui/slider';
import { usePlayerState } from '@/fronted/features/player/playerState';
import TimeUtil from '@/common/utils/TimeUtil';

/** 进度条提交跳转后保留显示目标时间的缓冲时长（毫秒），避免 seek 落地前滑块回弹一帧。 */
const SEEK_HOLD_DURATION_MS = 500;

/** 隔离高频播放时间展示组件的入参。 */
export interface PlaybackTimeReadoutProps {
    /** 正在拖动预览中的时间（秒）；未拖动时为 null，组件自行订阅精确播放时间。 */
    previewTime: number | null;
    /** 当前时间文本样式。 */
    currentClassName?: string;
    /** 分隔符样式。 */
    separatorClassName?: string;
    /** 总时长文本样式。 */
    durationClassName?: string;
    /** 外层容器样式。 */
    className?: string;
    /** 窄屏下隐藏总时长区域的容器类名，传入空字符串表示始终展示。 */
    durationWrapperClassName?: string;
}

/**
 * 隔离 22Hz 高频播放时间订阅的时间展示叶子组件，避免外层控制栏随每一帧重渲染。
 */
export const PlaybackTimeReadout = memo(function PlaybackTimeReadout({
    previewTime,
    currentClassName = '',
    separatorClassName = 'mx-1.5 text-white/40',
    durationClassName = 'text-white/60',
    className = 'h-full flex items-center font-mono text-xs text-white/80 tabular-nums',
    durationWrapperClassName = 'hidden lg:inline-flex items-center',
}: PlaybackTimeReadoutProps) {
    const playTime = usePlayerState((s) => s.internal.exactPlayTime);
    const duration = usePlayerState((s) => s.duration);
    const shownTime = previewTime ?? playTime;

    return (
        <div className={className}>
            <span className={currentClassName}>{TimeUtil.secondToTimeStr(shownTime)}</span>
            <span className={durationWrapperClassName || 'inline-flex items-center'}>
                <span className={separatorClassName}>/</span>
                <span className={durationClassName}>{TimeUtil.secondToTimeStr(duration)}</span>
            </span>
        </div>
    );
});

/** 隔离高频播放进度条组件的入参。 */
export interface PlaybackProgressSliderProps {
    /** 拖动或松手后同步给外部时间显示器的预览时间（非拖动中为 null）。 */
    previewTime: number | null;
    /** 通知外层更新拖动预览时间；不传时滑块仅在自身内部消化高频更新。 */
    onPreviewTimeChange?: (time: number | null) => void;
    /** 按下拖动改变值时的业务回调（如暂停播放或直接 seek）。 */
    onScrubValueChange?: (time: number) => void;
    /** 松手提交进度后的业务回调。 */
    onScrubCommit?: (time: number) => void;
    /** 无总时长时是否禁用交互；默认小于等于 0 时禁用。 */
    disableWhenEmpty?: boolean;
    /** 滑块根容器样式。 */
    className?: string;
    /** 轨道样式。 */
    trackClassName?: string;
    /** 已播区间样式。 */
    rangeClassName?: string;
    /** 手柄样式。 */
    thumbClassName?: string;
    /** 滑块步长。 */
    step?: number;
}

/**
 * 隔离 22Hz 高频播放进度订阅的进度条组件，避免控制栏按钮组在播放期反复重渲染。
 */
export const PlaybackProgressSlider = memo(function PlaybackProgressSlider({
    previewTime,
    onPreviewTimeChange,
    onScrubValueChange,
    onScrubCommit,
    disableWhenEmpty = true,
    className = 'w-full',
    trackClassName,
    rangeClassName,
    thumbClassName,
    step = 0.1,
}: PlaybackProgressSliderProps) {
    const playTime = usePlayerState((s) => s.internal.exactPlayTime);
    const duration = usePlayerState((s) => s.duration);
    const [draggingTime, setDraggingTime] = useState<number | null>(null);
    const holdTimerRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (holdTimerRef.current !== null) {
            window.clearTimeout(holdTimerRef.current);
        }
    }, []);

    const safeMax = disableWhenEmpty ? Math.max(duration, 0.1) : duration;
    const rawValue = previewTime ?? draggingTime ?? playTime;
    const clampedValue = disableWhenEmpty
        ? Math.min(Math.max(0, rawValue), safeMax)
        : rawValue;

    return (
        <Slider
            className={className}
            trackClassName={trackClassName}
            rangeClassName={rangeClassName}
            thumbClassName={thumbClassName}
            max={safeMax}
            min={0}
            step={step}
            disabled={disableWhenEmpty && duration <= 0}
            value={[clampedValue]}
            onValueChange={(value) => {
                const [next] = value;
                if (holdTimerRef.current !== null) {
                    window.clearTimeout(holdTimerRef.current);
                    holdTimerRef.current = null;
                }
                setDraggingTime(next);
                onPreviewTimeChange?.(next);
                onScrubValueChange?.(next);
            }}
            onValueCommit={(value) => {
                const [next] = value;
                setDraggingTime(next);
                onPreviewTimeChange?.(next);
                onScrubCommit?.(next);
                if (holdTimerRef.current !== null) {
                    window.clearTimeout(holdTimerRef.current);
                }
                holdTimerRef.current = window.setTimeout(() => {
                    holdTimerRef.current = null;
                    setDraggingTime(null);
                    onPreviewTimeChange?.(null);
                }, SEEK_HOLD_DURATION_MS);
            }}
        />
    );
});
