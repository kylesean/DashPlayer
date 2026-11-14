import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import VolumeSlider from '../VolumeSlider';
import { cn } from '@/frontend/lib/utils';
import SpeedSlider from '../SpeedSlider';
import { CONTROL_POPOVER_OFFSET_STACKED_BAR } from '@/frontend/features/player/components/ControlPopover';
import { MonitorPlay, Pause, Play } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { IconButton } from '@astryxdesign/core/IconButton';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import { usePlayerState } from '@/frontend/features/player/playerState';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import {
    PlaybackProgressSlider,
    PlaybackTimeReadout,
} from '@/frontend/features/player/components/PlaybackProgressControls';
import { setPodcastModeForCurrentVideo } from '@/frontend/features/player/podcastMode';

const logger = getRendererLogger('PodcastControlBar');

/**
 * 播客沉浸式视图控制栏组件入参。
 */
export interface PodcastControlBarProps {
    className?: string;
    onTimeChange?: (time: number) => void;
}

/**
 * 播客沉浸视图底部的控制条。
 * 进度条与播放时间订阅已被完全隔离在叶子组件中，避免 22Hz 刷新导致整条按钮频繁重渲染。
 */
export default function PodcastControlBar({
    className = '',
    onTimeChange,
}: PodcastControlBarProps) {
    const { volume, playbackRate, muted, playing } = usePlayerState(
        useShallow((s) => ({
            volume: s.volume,
            playbackRate: s.playbackRate,
            muted: s.muted,
            playing: s.playing,
        })),
    );

    const { t } = useI18nTranslation('player');
    const [previewTime, setPreviewTime] = useState<number | null>(null);

    const handleScrubCommit = useCallback((time: number) => {
        logger.debug('Podcast time slider scrub commit', { time });
        onTimeChange?.(time);
        playerActions.seekTo({ time });
        playerActions.setAutoPause(false);
        playerActions.setSingleRepeat(false);
    }, [onTimeChange]);

    return (
        <div className={cn('w-full pointer-events-auto transition-colors duration-300 pb-5 pt-2 px-8', className)}>
            <div className="w-full flex flex-col gap-3">
                {/* 细致平滑的进度条 */}
                <div className="w-full flex items-center">
                    <PlaybackProgressSlider
                        previewTime={previewTime}
                        onPreviewTimeChange={setPreviewTime}
                        onScrubValueChange={(time) => {
                            playerActions.seekTo({ time });
                            playerActions.setAutoPause(false);
                            playerActions.setSingleRepeat(false);
                        }}
                        onScrubCommit={handleScrubCommit}
                        className="cursor-pointer py-1"
                    />
                </div>

                {/* 底部控制项与时间展示 */}
                <div className="w-full flex justify-between items-center text-secondary">
                    <div className="flex gap-3.5 items-center">
                        <IconButton
                            label={playing ? t('controlBar.pause') : t('controlBar.play')}
                            variant="ghost"
                            size="sm"
                            icon={playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                            onClick={() => {
                                if (playing) {
                                    playerActions.pause();
                                } else {
                                    playerActions.play();
                                }
                            }}
                        />
                        <PlaybackTimeReadout
                            previewTime={previewTime}
                            className="flex items-center font-mono text-sm tabular-nums text-secondary"
                            currentClassName="text-primary font-medium"
                            separatorClassName="mx-1.5 opacity-40"
                            durationClassName=""
                            durationWrapperClassName="inline-flex items-center"
                        />
                    </div>

                    <div className="flex justify-center items-center gap-4 text-secondary">
                        <SpeedSlider
                            speed={playbackRate}
                            popoverOffset={CONTROL_POPOVER_OFFSET_STACKED_BAR}
                            onSpeedChange={(speed) => playerActions.setPlaybackRate(speed)}
                        />
                        <VolumeSlider
                            muted={muted}
                            onMutedChange={(nextMuted) => playerActions.setMuted(nextMuted)}
                            volume={volume}
                            onVolumeChange={(nextVolume) => playerActions.setVolume(nextVolume)}
                        />
                        <span aria-hidden="true" className="h-4 w-px bg-border" />
                        {/* 播客模式会盖住视频条与学习台，这里必须留一个常显的出口，
                            否则用户只能在自动切换的 5 秒 toast 里点“恢复” */}
                        <button
                            type="button"
                            onClick={() => setPodcastModeForCurrentVideo(false)}
                            title={t('controlBar.exitPodcastHint')}
                            aria-label={t('controlBar.exitPodcast')}
                            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-secondary transition-colors hover:bg-muted hover:text-primary"
                        >
                            <MonitorPlay className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{t('controlBar.exitPodcast')}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
