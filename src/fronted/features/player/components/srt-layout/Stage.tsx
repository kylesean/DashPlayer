import { type ReactElement, useCallback, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import PlayerEngine from '@/fronted/features/player/components/PlayerEngine';
import { usePlayerState } from '@/fronted/features/player/playerState';
import useLayout from '@/fronted/app/stores/layoutStore';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import { getBaseViewBeforeOverlay } from '@/fronted/features/player/lib/player-view-sync';
import PlaybackControlBar from './ControlBar';
import HardsubMask from '@/fronted/features/player/components/HardsubMask';
import FullscreenSubtitleOverlay from '@/fronted/features/player/components/subtitles/FullscreenSubtitleOverlay';
import {
    MEDIA_FRAME_CLASS,
    MEDIA_MATTE_CLASS,
} from '@/fronted/features/player/components/mediaSurface';
import { cn } from '@/fronted/lib/utils';

/**
 * 播放舞台组件入参。
 */
export interface PlaybackStageProps {
    className?: string;
    onReady?: () => void;
    onEnded?: () => void;
}

/**
 * 承载视频播放区域、硬字幕遮罩与全屏字幕覆盖层的播放舞台组件。
 */
export default function PlaybackStage({ className = '', onReady, onEnded }: PlaybackStageProps): ReactElement {
    const { t } = useTranslation('practice');
    const hasSource = usePlayerState((state) => !!state.src);

    // 视频元素本身（不只是 ref）也要交给遮挡带：它要读 videoWidth / videoHeight 对齐真实画面
    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

    const fullScreen = useLayout((s) => s.fullScreen);
    const podcastMode = useLayout((s) => s.podcastMode);
    const practiceVisible = usePracticePanel((s) => s.visible);
    const showAudioPracticeStage = practiceVisible && (
        getBaseViewBeforeOverlay() === 'podcast'
        || (videoElement !== null && videoElement.readyState >= 1 && videoElement.videoWidth === 0)
    );
    const stageRef = useRef<HTMLDivElement>(null);

    const handleProvideVideoElement = useCallback((video: HTMLVideoElement | null) => {
        setVideoElement(video);
    }, []);

    const handlePlayerReady = useCallback(() => {
        onReady?.();
    }, [onReady]);

    const handlePlayerEnded = useCallback(() => {
        onEnded?.();
    }, [onEnded]);

    if (!hasSource) {
        return <div />;
    }

    return (
        <div
            ref={stageRef}
            className={cn(
                'relative h-full w-full overflow-hidden transition-colors duration-300',
                MEDIA_MATTE_CLASS,
                MEDIA_FRAME_CLASS,
                className
            )}
        >
            <div className="relative z-10 flex h-full w-full items-center justify-center">
                {/* 视频核心播放引擎 */}
                <PlayerEngine
                    width="100%"
                    height="100%"
                    className="w-full h-full absolute top-0 left-0 object-contain"
                    onReady={handlePlayerReady}
                    onEnded={handlePlayerEnded}
                    onProvideVideoElement={handleProvideVideoElement}
                />

                {/* 硬字幕遮挡：只盖画面，不进入视频层的点击链路 */}
                {!podcastMode && <HardsubMask video={videoElement} />}

                {/* 纯音频/播客源打开练习工作台时展示轻氛围指示，避免顶部舞台一片黑屏 */}
                {showAudioPracticeStage && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/95 text-center px-6">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/60 bg-surface text-accent shadow-xs">
                            <AudioLines className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-medium text-foreground">
                            {t('panel.audioStageTitle', { defaultValue: '音频沉浸练习模式' })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {t('panel.audioStageHint', { defaultValue: '关闭练习台后将自动回到播客字幕视图' })}
                        </p>
                    </div>
                )}

                {(!fullScreen || practiceVisible) && !podcastMode && (
                    <PlaybackControlBar
                        onTimeChange={(time) => playerActions.seekTo({ time })}
                        className="absolute left-0"
                    />
                )}
                {fullScreen && <FullscreenSubtitleOverlay />}
            </div>
        </div>
    );
}
