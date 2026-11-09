import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import VolumeSlider from '../VolumeSlider';
import SpeedSlider from '../SpeedSlider';
import useLayout from '@/fronted/app/stores/layoutStore';
import FullscreenToggleButton from './FullscreenToggleButton';
import ControlBarPinButton from './ControlBarPinButton';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import {
    DARK_BAR_BUTTON_HOVER,
    PlaybackNavControls
} from '@/fronted/features/player/components/PlaybackGlobalControls';
import HardsubMaskButton from '@/fronted/features/player/components/HardsubMaskButton';
import TrainingMenuButton from '@/fronted/features/player/components/learning-toolbar/TrainingMenuButton';
import SubtitleTrackSegmented from '@/fronted/features/player/components/learning-toolbar/SubtitleTrackSegmented';
import PlayerSettingsPopover from '@/fronted/features/player/components/learning-toolbar/PlayerSettingsPopover';
import { CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR } from '@/fronted/features/player/components/ControlPopover';
import {
    FULLSCREEN_CONTROL_BAR_PANEL_HEIGHT_PX,
    FULLSCREEN_CONTROL_BAR_ZONE_PX,
} from '@/fronted/features/player/components/controlBarZone';
import { useHardsubMaskBarAdjust } from '@/fronted/features/player/components/hardsubMaskBarLayout';
import {
    PlaybackProgressSlider,
    PlaybackTimeReadout,
} from '@/fronted/features/player/components/PlaybackProgressControls';

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
            {/*
              玻璃拟态药丸胶囊：
              - 限制最大宽度（max-w-4xl），超宽屏居中好看
              - 幽灵态（用户拖贴片盖住本条但未抬起）降透明度让位给贴片，提示用户控制条还在
            */}
            <div
                className={cn(
                    'w-full max-w-4xl px-3.5 py-1.5 rounded-xl border transition-all duration-300 shadow-2xl backdrop-blur-md',
                    // 未激活时半透明，激活时常亮
                    'bg-black/70 hover:bg-black/85 border-white/15',
                    barVisible ? 'opacity-100 pointer-events-auto translate-y-0' : 'opacity-0 pointer-events-none translate-y-2',
                    maskAdjust.ghost && 'opacity-25 pointer-events-none'
                )}
            >
                <div className="flex items-center gap-2">
                    <div className="flex gap-2 items-center shrink-0">
                        {/* 上一句 / 播放暂停 / 下一句：与普通控制条共用同一份控件 */}
                        <PlaybackNavControls />
                        <PlaybackTimeReadout previewTime={previewTime} />
                    </div>
                    <div className="flex-1 px-2 flex items-center">
                        <PlaybackProgressSlider
                            previewTime={previewTime}
                            onPreviewTimeChange={setPreviewTime}
                            onScrubValueChange={() => playerActions.pause()}
                            onScrubCommit={handleScrubCommit}
                        />
                    </div>
                    {/* 右侧按钮组：与普通控制条保持同样的间隙收紧策略（xl 以下 gap-1），两条条子不能长得不一样 */}
                    <div className="flex justify-center items-center gap-1 xl:gap-2 shrink-0">
                        {/* 与窗口内同一套控件：设置项只有一份实现，两条控制条不再各写一遍 */}
                        <TrainingMenuButton
                            tone="overlay"
                            popoverOffset={CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR}
                            onMenuOpenChange={setTrainingMenuOpen}
                        />
                        <SubtitleTrackSegmented tone="overlay" />
                        <HardsubMaskButton />
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
                            muted={muted}
                            onMutedChange={(nextMuted) => playerActions.setMuted(nextMuted)}
                            volume={volume}
                            onVolumeChange={(nextVolume) => playerActions.setVolume(nextVolume)}
                            triggerClassName={DARK_BAR_BUTTON_HOVER}
                            collapseSliderBelowXl
                        />
                        <ControlBarPinButton />
                        <PlayerSettingsPopover
                            tone="overlay"
                            popoverOffset={CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR}
                            onMenuOpenChange={setSettingsMenuOpen}
                        />
                        <FullscreenToggleButton fullScreen={fullScreen} changeFullScreen={changeFullScreen} />
                    </div>
                </div>
            </div>
        </div>
    );
}
