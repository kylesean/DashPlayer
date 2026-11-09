import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import PlayerEngine from '@/fronted/features/player/components/PlayerEngine';
import { usePlayerState } from '@/fronted/features/player/playerState';
import useLayout from '@/fronted/app/stores/layoutStore';
import PlaybackControlBar from './ControlBar';
import HardsubMask from '@/fronted/features/player/components/HardsubMask';
import FullscreenSubtitleOverlay from '@/fronted/features/player/components/subtitles/FullscreenSubtitleOverlay';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import {
    MEDIA_AMBIENT_CANVAS_CLASS,
    MEDIA_FRAME_CLASS,
    MEDIA_MATTE_CLASS,
    MEDIA_VIGNETTE_CLASS,
} from '@/fronted/features/player/components/mediaSurface';
import { computePictureRect } from '@/fronted/features/player/components/hardsubMaskGeometry';
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
    const hasSource = usePlayerState((state) => !!state.src);

    // 视频元素本身（不只是 ref）也要交给遮挡带：它要读 videoWidth / videoHeight 对齐真实画面
    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

    const fullScreen = useLayout((s) => s.fullScreen);
    const podcastMode = useLayout((s) => s.podcastMode);
    const ambientLight = usePlayerUi((s) => s.ambientLight);
    const stageRef = useRef<HTMLDivElement>(null);
    const ambientCanvasRef = useRef<HTMLCanvasElement>(null);


    // 在根容器底层驱动空间环境光：动态感知视频实际相对位置与比例，实现不规则空间光场投射
    useEffect(() => {
        // 环境光默认关闭：不挂载画布、也不启动 24fps 重绘
        if (!videoElement || podcastMode || !hasSource || !ambientLight) {
            return undefined;
        }
        let animationFrameId: number | undefined;
        let cancelled = false;
        let lastDrawTime = 0;
        let lastCanvasW = 0;
        let lastCanvasH = 0;
        const fps = 24;
        const drawInterval = 1000 / fps;

        /** 把当前视频帧画进环境光画布（只依赖画面尺寸，不关心播放状态）。 */
        const drawAmbient = () => {
            const backgroundCanvas = ambientCanvasRef.current;
            const rootContainer = stageRef.current;
            if (!backgroundCanvas || !rootContainer || videoElement.readyState < 2 || videoElement.seeking) {
                return;
            }
            const ctx = backgroundCanvas.getContext('2d', { alpha: false });
            if (!ctx) {
                return;
            }
            const rootRect = rootContainer.getBoundingClientRect();
            // 环境光对齐的是对象在画面里真实渲染的那块（contain 之后的矩形），
            // 不是铺满面板的 <video> 盒子，否则光晕会被拉成面板比例。
            const picture = computePictureRect(
                rootRect.width,
                rootRect.height,
                videoElement.videoWidth,
                videoElement.videoHeight
            );

            const ratio = window.devicePixelRatio || 1;
            const resolutionFactor = 0.2; // 高性能低分辨率缓冲绘制
            const scaledRootW = Math.max(1, Math.floor(rootRect.width * ratio * resolutionFactor));
            const scaledRootH = Math.max(1, Math.floor(rootRect.height * ratio * resolutionFactor));

            if (scaledRootW !== lastCanvasW || scaledRootH !== lastCanvasH) {
                backgroundCanvas.width = scaledRootW;
                backgroundCanvas.height = scaledRootH;
                lastCanvasW = scaledRootW;
                lastCanvasH = scaledRootH;
            }

            // 动态计算视频在根容器中的真实绝对坐标与尺寸（自动适应普通分栏拖拽与全屏居中）
            const relX = picture.left / rootRect.width;
            const relY = picture.top / rootRect.height;
            const relW = picture.width / rootRect.width;
            const relH = picture.height / rootRect.height;

            // 柔和向外溢出延伸（Padding Expansion），让光晕自然蔓延渗透到右侧和下方
            const expandFactor = 0.25;
            const drawX = Math.max(0, (relX - relW * expandFactor) * scaledRootW);
            const drawY = Math.max(0, (relY - relH * expandFactor) * scaledRootH);
            const drawW = Math.min(scaledRootW, (relW * (1 + expandFactor * 2)) * scaledRootW);
            const drawH = Math.min(scaledRootH, (relH * (1 + expandFactor * 2)) * scaledRootH);

            ctx.drawImage(videoElement, drawX, drawY, drawW, drawH);
        };

        const syncVideos = () => {
            if (cancelled) return;
            const now = performance.now();
            if (now - lastDrawTime >= drawInterval) {
                // 播放中才持续重绘；暂停/拖动由下面的事件各补一帧
                if (!videoElement.paused) {
                    drawAmbient();
                }
                lastDrawTime = now;
            }
            if (cancelled) return;
            animationFrameId = requestAnimationFrame(syncVideos);
        };

        // 暂停、拖动、加载完成时也画一帧：否则视频周围只剩应用底色，看起来像一块灰板
        const repaint = () => drawAmbient();
        videoElement.addEventListener('pause', repaint);
        videoElement.addEventListener('seeked', repaint);
        videoElement.addEventListener('loadeddata', repaint);
        // 打开时视频可能已经加载完成（不会再触发 loadeddata）
        drawAmbient();

        animationFrameId = requestAnimationFrame(syncVideos);
        return () => {
            cancelled = true;
            videoElement.removeEventListener('pause', repaint);
            videoElement.removeEventListener('seeked', repaint);
            videoElement.removeEventListener('loadeddata', repaint);
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [videoElement, podcastMode, hasSource, ambientLight]);

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
            {/* 可选环境光：只铺在视频面板内（遮幅区域），默认不渲染，关闭时也不启动重绘 */}
            {ambientLight && !podcastMode && (
                <canvas ref={ambientCanvasRef} className={MEDIA_AMBIENT_CANVAS_CLASS} />
            )}
            {ambientLight && !podcastMode && (
                <div className={cn('pointer-events-none absolute inset-0 z-0', MEDIA_VIGNETTE_CLASS)} />
            )}

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

                {!fullScreen && !podcastMode && (
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
