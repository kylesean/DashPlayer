import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import VolumeSlider from '../VolumeSlider';
import { cn } from '@/fronted/lib/utils';
import SpeedSlider from '../SpeedSlider';
import { CONTROL_POPOVER_OFFSET_STACKED_BAR } from '@/fronted/features/player/components/ControlPopover';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/fronted/components/ui/button';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import {
    PlaybackProgressSlider,
    PlaybackTimeReadout,
} from '@/fronted/features/player/components/PlaybackProgressControls';

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
                        trackClassName="bg-zinc-200/70 dark:bg-zinc-800/80"
                        rangeClassName="bg-zinc-400 dark:bg-zinc-500"
                        thumbClassName="border-zinc-400 dark:border-zinc-500 bg-white dark:bg-zinc-900 shadow-sm"
                    />
                </div>

                {/* 底部控制项与时间展示 */}
                <div className="w-full flex justify-between items-center text-zinc-500 dark:text-zinc-400">
                    <div className="flex gap-3.5 items-center">
                        <Button
                            onClick={() => {
                                if (playing) {
                                    playerActions.pause();
                                } else {
                                    playerActions.play();
                                }
                            }}
                            size="icon"
                            variant="ghost"
                            className="w-9 h-9 rounded-full text-zinc-800 dark:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        >
                            {playing ? (
                                <Pause className="w-4 h-4" />
                            ) : (
                                <Play className="w-4 h-4 ml-0.5" />
                            )}
                        </Button>
                        <PlaybackTimeReadout
                            previewTime={previewTime}
                            className="flex items-center font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
                            currentClassName="text-zinc-800 dark:text-zinc-200 font-medium"
                            separatorClassName="mx-1.5 opacity-40"
                            durationClassName=""
                            durationWrapperClassName="inline-flex items-center"
                        />
                    </div>

                    <div className="flex justify-center items-center gap-4 text-zinc-600 dark:text-zinc-400">
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
                            sliderTrackClassName="bg-zinc-200/70 dark:bg-zinc-800/80"
                            sliderRangeClassName="bg-zinc-400 dark:bg-zinc-500"
                            sliderThumbClassName="border-zinc-400 dark:border-zinc-500 bg-white dark:bg-zinc-900 shadow-sm"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
