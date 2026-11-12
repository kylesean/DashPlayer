import { useCallback, useEffect, useRef, useState } from 'react';
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
    MEDIA_BAR_DIVIDER,
    MEDIA_BAR_GROUP,
    PlaybackNavControls
} from '@/fronted/features/player/components/PlaybackGlobalControls';
import PlaybackBarShell from '@/fronted/features/player/components/PlaybackBarShell';
import HardsubMaskButton from '@/fronted/features/player/components/HardsubMaskButton';
import PodcastModeButton from '@/fronted/features/player/components/PodcastModeButton';
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
    useEffect(() => () => {
        while (mouseOverTimeout.current.length > 0) {
            const timer = mouseOverTimeout.current.pop();
            if (timer !== undefined) {
                window.clearTimeout(timer);
            }
        }
    }, []);
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
                'w-full flex flex-col-reverse h-36 text-media-fg/90 px-4 pb-8 pt-2 pointer-events-auto',
                'transition-[bottom] duration-200 ease-out',
                className
            )}
        >
            <PlaybackBarShell
                tone="inline"
                visible={barVisible}
                ghost={maskAdjust.ghost}
                leading={(
                    <>
                        {/* 上一句 / 播放暂停 / 下一句：与全屏控制条共用同一份控件 */}
                        <PlaybackNavControls />
                        <PlaybackTimeReadout previewTime={previewTime} />
                    </>
                )}
                progress={(
                    <PlaybackProgressSlider
                        tone="media"
                        previewTime={previewTime}
                        onPreviewTimeChange={setPreviewTime}
                        onScrubCommit={handleScrubCommit}
                    />
                )}
                trailing={(
                    <>
                        {/* 「看画面」的模式开关成组：硬字幕遮挡 / 播客 */}
                        <div className={MEDIA_BAR_GROUP}>
                            <HardsubMaskButton />
                            <PodcastModeButton />
                        </div>
                        <span className={MEDIA_BAR_DIVIDER} aria-hidden />
                        {/* 播放工具成组：倍速 / 音量 / 钉住 / 全屏 */}
                        <div className={MEDIA_BAR_GROUP}>
                            <SpeedSlider
                                speed={playbackRate}
                                popoverOffset={CONTROL_POPOVER_OFFSET_STACKED_BAR}
                                triggerClassName={DARK_BAR_BUTTON_HOVER}
                                onSpeedChange={(speed) => playerActions.setPlaybackRate(speed)}
                            />
                            <VolumeSlider
                                tone="media"
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
                    </>
                )}
                onMouseMove={(e) => {
                    e.stopPropagation();
                    handleMouseMoveIn();
                }}
            />
        </div>
    );
}
