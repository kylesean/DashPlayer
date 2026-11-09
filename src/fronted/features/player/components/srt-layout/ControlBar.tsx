import { useCallback, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import VolumeSlider from '../VolumeSlider';
import SpeedSlider from '../SpeedSlider';
import { cn } from '@/fronted/lib/utils';
import useLayout from '@/fronted/app/stores/layoutStore';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import FullscreenToggleButton from '@/fronted/features/player/components/subtitles/FullscreenToggleButton';
import ControlBarPinButton from '@/fronted/features/player/components/subtitles/ControlBarPinButton';
import {
    DARK_BAR_BUTTON_HOVER,
    PlaybackNavControls
} from '@/fronted/features/player/components/PlaybackGlobalControls';
import HardsubMaskButton from '@/fronted/features/player/components/HardsubMaskButton';
import { CONTROL_POPOVER_OFFSET_STACKED_BAR } from '@/fronted/features/player/components/ControlPopover';
import {
    CONTROL_BAR_GAP_PX,
    CONTROL_BAR_PANEL_HEIGHT_PX,
    CONTROL_BAR_ZONE_PX,
} from '@/fronted/features/player/components/controlBarZone';
import { useHardsubMaskBarAdjust } from '@/fronted/features/player/components/hardsubMaskBarLayout';
import {
    PlaybackProgressSlider,
    PlaybackTimeReadout,
} from '@/fronted/features/player/components/PlaybackProgressControls';

const logger = getRendererLogger('PlaybackControlBar');

/**
 * 嵌入式播放控制条组件入参。
 */
export interface PlaybackControlBarProps {
    className?: string;
    onTimeChange?: (time: number) => void;
}

/**
 * 视频区域底部悬浮的主播放控制栏。
 * 进度条与播放时间高频订阅已被完全隔离在叶子组件中，避免 22Hz 刷新导致整条按钮频繁重渲染。
 */
export default function PlaybackControlBar({
    className = '',
    onTimeChange
}: PlaybackControlBarProps) {
    const {
        volume,
        playbackRate,
        muted
    } = usePlayerState(
        useShallow((state) => ({
            volume: state.volume,
            playbackRate: state.playbackRate,
            muted: state.muted
        }))
    );

    const [previewTime, setPreviewTime] = useState<number | null>(null);
    const fullScreen = useLayout((s) => s.fullScreen);
    const changeFullScreen = useLayout((s) => s.changeFullScreen);
    // 用户钉住后控制条常显，不再受鼠标超时隐藏影响
    const pinned = usePlayerUi((s) => s.controlBarPinned);
    // 遮挡贴片对本条的让位 / 幽灵态 / 抬起量：与全屏条共用同一份判断，只是面板尺寸不同
    const maskAdjust = useHardsubMaskBarAdjust({
        panelHeightPx: CONTROL_BAR_PANEL_HEIGHT_PX,
        zonePx: CONTROL_BAR_ZONE_PX,
        gapPx: CONTROL_BAR_GAP_PX,
    });

    const [mouseOverOut, setMouseOverOut] = useState<boolean>(false);
    const mouseOverTimeout = useRef<number[]>([]);
    // 本条是否该显形：钉住/鼠标在条上才算「想显示」，且鼠标压到贴片上时要让位
    const barVisible = (mouseOverOut || pinned) && !maskAdjust.hiddenByMask;

    const onMouseLeave = () => {
        while (mouseOverTimeout.current.length > 0) {
            const timer = mouseOverTimeout.current.pop();
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
        }
        setMouseOverOut(false);
    };

    const handleMouseMove = () => {
        while (mouseOverTimeout.current.length > 0) {
            const timer = mouseOverTimeout.current.pop();
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
        }
        if (!mouseOverOut) {
            setMouseOverOut(true);
        }
        const timeout = window.setTimeout(() => {
            setMouseOverOut(false);
        }, 2000);
        mouseOverTimeout.current.push(timeout);
    };

    const handleMouseMoveIn = () => {
        while (mouseOverTimeout.current.length > 0) {
            const timer = mouseOverTimeout.current.pop();
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
        }
        if (!mouseOverOut) {
            setMouseOverOut(true);
        }
    };

    const handleScrubCommit = useCallback((time: number) => {
        logger.debug('time slider commit', { time });
        onTimeChange?.(time);
        playerActions.setAutoPause(false);
        playerActions.setSingleRepeat(false);
    }, [onTimeChange]);

    return (
        <div
            onMouseMove={handleMouseMove}
            onMouseLeave={onMouseLeave}
            style={{ bottom: maskAdjust.liftPx + CONTROL_BAR_GAP_PX }}
            className={cn(
                'w-full flex flex-col-reverse h-36 text-white/90 px-4 pb-8 pt-2 pointer-events-auto',
                'transition-[bottom] duration-200 ease-out',
                className
            )}
        >
            <div
                className={cn(
                    'relative z-20 w-full px-2 lg:px-4 py-3 rounded-2xl border border-white/10 bg-black/60 backdrop-blur-md shadow-2xl transition-opacity duration-200 ease-out pointer-events-auto',
                    maskAdjust.ghost
                        ? 'opacity-40 pointer-events-none'
                        : barVisible
                        ? 'opacity-100'
                        : 'opacity-0 pointer-events-none'
                )}
                onMouseMove={(e) => {
                    e.stopPropagation();
                    handleMouseMoveIn();
                }}
            >
                <div className="flex flex-col items-center justify-between w-full gap-2.5">
                    <PlaybackProgressSlider
                        previewTime={previewTime}
                        onPreviewTimeChange={setPreviewTime}
                        onScrubCommit={handleScrubCommit}
                    />
                    <div className="w-full flex justify-between items-center">
                        <div className="flex gap-2 items-center">
                            {/* 上一句 / 播放暂停 / 下一句：与全屏控制条共用同一份控件 */}
                            <PlaybackNavControls />
                            <PlaybackTimeReadout previewTime={previewTime} />
                        </div>
                        <div className="h-full flex-1" />
                        {/* 右侧按钮组：xl 以下收紧间隙。窄窗时这一排摆不下，gap-2 的间隙白花掉十几像素，
                            最右那颗图标就会被容器边缘切掉一半；缩小间隙比藏掉控件代价小得多 */}
                        <div className="flex justify-center items-center gap-1 xl:gap-2">
                            {/* 只看画面的一键开关；训练/字幕/设置都在字幕学习台里，不在这条上 */}
                            <HardsubMaskButton />
                            <SpeedSlider
                                speed={playbackRate}
                                popoverOffset={CONTROL_POPOVER_OFFSET_STACKED_BAR}
                                triggerClassName={DARK_BAR_BUTTON_HOVER}
                                onSpeedChange={(speed) => playerActions.setPlaybackRate(speed)}
                            />
                            <VolumeSlider
                                muted={muted}
                                onMutedChange={(nextMuted) => playerActions.setMuted(nextMuted)}
                                volume={volume}
                                onVolumeChange={(nextVolume) => playerActions.setVolume(nextVolume)}
                                triggerClassName={DARK_BAR_BUTTON_HOVER}
                                collapseSliderBelowXl
                            />
                            <ControlBarPinButton />
                            <FullscreenToggleButton fullScreen={fullScreen} changeFullScreen={changeFullScreen} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
