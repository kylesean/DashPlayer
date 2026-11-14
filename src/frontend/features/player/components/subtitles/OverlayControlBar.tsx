import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import VolumeSlider from '../VolumeSlider';
import SpeedSlider from '../SpeedSlider';
import useLayout from '@/frontend/app/stores/layoutStore';
import FullscreenToggleButton from './FullscreenToggleButton';
import ControlBarPinButton from './ControlBarPinButton';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import { cn } from '@/frontend/lib/utils';
import PlaybackBarShell from '@/frontend/features/player/components/PlaybackBarShell';
import { usePlayerState } from '@/frontend/features/player/playerState';
import { usePlayerUi } from '@/frontend/features/player/playerUiStore';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import {
    DARK_BAR_BUTTON_HOVER,
    MEDIA_BAR_DIVIDER,
    MEDIA_BAR_GROUP,
    PlaybackNavControls
} from '@/frontend/features/player/components/PlaybackGlobalControls';
import HardsubMaskButton from '@/frontend/features/player/components/HardsubMaskButton';
import PodcastModeButton from '@/frontend/features/player/components/PodcastModeButton';
import TrainingMenuButton from '@/frontend/features/player/components/learning-toolbar/TrainingMenuButton';
import SubtitleTrackSegmented from '@/frontend/features/player/components/learning-toolbar/SubtitleTrackSegmented';
import PlayerSettingsPopover from '@/frontend/features/player/components/learning-toolbar/PlayerSettingsPopover';
import { CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR } from '@/frontend/features/player/components/ControlPopover';
import {
    FULLSCREEN_CONTROL_BAR_PANEL_HEIGHT_PX,
    FULLSCREEN_CONTROL_BAR_ZONE_PX,
} from '@/frontend/features/player/components/controlBarZone';
import { useHardsubMaskBarAdjust } from '@/frontend/features/player/components/hardsubMaskBarLayout';
import {
    PlaybackProgressSlider,
    PlaybackTimeReadout,
} from '@/frontend/features/player/components/PlaybackProgressControls';

const logger = getRendererLogger('OverlayControlBar');

/**
 * 全屏浮层控制条组件入参。
 */
export interface OverlayControlBarProps {
    className?: string;
    onTimeChange?: (time: number) => void;
}

/**
 * 全屏状态下悬浮在画面底部的半透明控制条。
 * 进度条与播放时间订阅已被完全隔离在叶子组件中，避免 22Hz 刷新导致整条按钮频繁重渲染。
 */
export default function OverlayControlBar({
    className = '',
    onTimeChange
}: OverlayControlBarProps) {
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
    const [mouseOver, setMouseOver] = useState<boolean>(false);
    // 鼠标一挪就亮、停 2.6s 后淡出的“临时显形”状态：
    // 控制条外层的待命区是 pointer-events-none，只靠 onMouseEnter 永远叫不出来，
    // 全屏下又没有别的入口，会把用户困在没法退出的画面里
    const [activated, setActivated] = useState<boolean>(false);
    // 训练菜单 / 设置弹层展开期间钉住控制条：鼠标移向菜单会先离开本条区域
    const [trainingMenuOpen, setTrainingMenuOpen] = useState<boolean>(false);
    const [settingsMenuOpen, setSettingsMenuOpen] = useState<boolean>(false);
    const menuOpen = trainingMenuOpen || settingsMenuOpen;

    const fullScreen = useLayout((s) => s.fullScreen);
    const changeFullScreen = useLayout((s) => s.changeFullScreen);
    // 用户钉住后控制条常显，不再受鼠标移出隐藏影响（与普通视图条共用同一开关）
    const pinned = usePlayerUi((s) => s.controlBarPinned);
    // 遮挡贴片对本条的让位 / 幽灵态 / 抬起量：与普通视图条共用同一份判断
    const maskAdjust = useHardsubMaskBarAdjust({
        panelHeightPx: FULLSCREEN_CONTROL_BAR_PANEL_HEIGHT_PX,
        zonePx: FULLSCREEN_CONTROL_BAR_ZONE_PX,
        gapPx: 0,
    });
    const barVisible = (activated || mouseOver || menuOpen || pinned) && !maskAdjust.hiddenByMask;

    useEffect(() => {
        let hideTimer: number | undefined;
        const handleMouseMove = () => {
            setActivated(true);
            if (hideTimer) {
                window.clearTimeout(hideTimer);
            }
            hideTimer = window.setTimeout(() => setActivated(false), 2600);
        };
        window.addEventListener('mousemove', handleMouseMove);
        // 进入全屏先亮一次，让用户知道退出按钮在哪里
        handleMouseMove();
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            if (hideTimer) {
                window.clearTimeout(hideTimer);
            }
        };
    }, []);

    const handleScrubCommit = useCallback((time: number) => {
        logger.debug('Time slider scrub committed', { value: time });
        onTimeChange?.(time);
        playerActions.setAutoPause(false);
        playerActions.setSingleRepeat(false);
    }, [onTimeChange]);

    return (
        <div
            onMouseEnter={() => {
                setMouseOver(true);
            }}
            onMouseLeave={() => {
                setMouseOver(false);
            }}
            // 贴底悬浮，横跨全屏宽度；下垫安全边距避免贴边不易点击
            className={cn(
                'absolute bottom-0 left-0 right-0 z-30 flex justify-center pb-2 px-3 select-none transition-all duration-300 pointer-events-none',
                // 让位生效时下内边距加上抬起量，把整条顶到遮挡带上方；抬起期间不给过渡时长，随贴片拖动即时跟随
                maskAdjust.liftPx > 0 && 'duration-0',
                className
            )}
            style={{
                // pointer-events 通过内层恢复，只有进入感应区才可交互
                paddingBottom: `calc(0.5rem + ${maskAdjust.liftPx}px)`,
            }}
        >
            <PlaybackBarShell
                tone="overlay"
                visible={barVisible}
                ghost={maskAdjust.ghost}
                leading={(
                    <>
                        {/* 上一句 / 播放暂停 / 下一句：与窗口内控制条共用同一份控件 */}
                        <PlaybackNavControls />
                        <PlaybackTimeReadout previewTime={previewTime} />
                    </>
                )}
                progress={(
                    <PlaybackProgressSlider
                        tone="media"
                        previewTime={previewTime}
                        onPreviewTimeChange={setPreviewTime}
                        onScrubValueChange={() => playerActions.pause()}
                        onScrubCommit={handleScrubCommit}
                    />
                )}
                trailing={(
                    <>
                        {/* 学习工具成组：训练 / 字幕轨道 / 设置 */}
                        <div className={MEDIA_BAR_GROUP}>
                            <TrainingMenuButton
                                tone="overlay"
                                popoverOffset={CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR}
                                onMenuOpenChange={setTrainingMenuOpen}
                            />
                            <SubtitleTrackSegmented tone="overlay" />
                            <PlayerSettingsPopover
                                tone="overlay"
                                popoverOffset={CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR}
                                onMenuOpenChange={setSettingsMenuOpen}
                            />
                        </div>
                        <span className={MEDIA_BAR_DIVIDER} aria-hidden />
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
                                popoverOffset={CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR}
                                triggerClassName={DARK_BAR_BUTTON_HOVER}
                                onSpeedChange={(speed) => playerActions.setPlaybackRate(speed)}
                                onSelectFinish={() => {
                                    setMouseOver(false);
                                }}
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
            />
        </div>
    );
}
