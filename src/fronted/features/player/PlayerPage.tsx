import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate, useParams, useSearchParams} from 'react-router-dom';
import useLayout, {cpW} from '@/fronted/app/stores/layoutStore';
import {cn} from '@/fronted/lib/utils';
import ControlButton from '@/fronted/features/player/components/ControlButton';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import PlayerShortcut from '@/fronted/features/player/components/PlayerShortcut';
import SideBar from '@/fronted/components/layout/SideBar';
import useChatPanel from '@/fronted/features/chat/chatStore';
import useSWR from 'swr';
import PlaybackLayout from '@/fronted/features/player/components/srt-layout/Layout';
import {SWR_KEY, swrMutate} from '@/fronted/lib/swr-util';
import PathUtil from '@/common/utils/PathUtil';
import MediaUtil from '@/common/utils/MediaUtil';
import {getRendererLogger} from '@/fronted/log/simple-logger';
import toast, { type Toast } from 'react-hot-toast';
import {ModeSwitchToast} from '@/fronted/components/shared/toasts/ModeSwitchToast';
import useSystem from '@/fronted/app/stores/systemStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import useSubtitleTranslation from '@/fronted/features/player/translationStore';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { useDevPlayerEntry } from '@/fronted/features/player/dev/useDevPlayerEntry';

const logger = getRendererLogger('PlayerWithControlsPage');
const MODE_SWITCH_TOAST_ID = 'mode-switch-toast';
const PlayerWithControlsPage = () => {
    const { t } = useI18nTranslation('player');
    const {videoId} = useParams();
    const navigate = useNavigate();
    const [_searchParams, setSearchParams] = useSearchParams();
    // dev/qa 入口：`?file=` 直接把路径换成观看记录，跳过「入库 → 点进去」的前置（打包版忽略）
    const devEntry = useDevPlayerEntry(_searchParams);
    // 请求了 dev 入口就必须等它给出记录 ID，不能拿路由里的占位 ID 去查详情
    const rawVideoId = devEntry.requested ? devEntry.videoId : videoId;
    const effectiveVideoId = rawVideoId && rawVideoId !== 'undefined' ? rawVideoId : undefined;
    const {data: video} = useSWR(
        effectiveVideoId ? [SWR_KEY.PLAYER_P, effectiveVideoId] : null,
        ([_key, id]) => playerApi.getPlayerDetail(id)
    );
    logger.debug('pa-player page loaded', {videoId: effectiveVideoId, hasVideo: !!video});
    const { data: windowState } = useSWR(SWR_KEY.WINDOW_SIZE, playerApi.getWindowState);
    const isMac = useSystem((s) => s.isMac);
    const showSideBar = useLayout((state) => state.showSideBar);
    const titleBarHeight = useLayout((state) => state.titleBarHeight);
    const uiFullScreen = useLayout((s) => s.fullScreen);
    const videoLoaded = usePlaybackSession((s) => s.videoLoaded);
    const w = cpW.bind(
        null,
        useLayout((s) => s.width)
    );
    const h = cpW.bind(
        null,
        useLayout((s) => s.height)
    );
    const location = useLocation();
    const referrer = location.state && location.state.referrer;
    logger.debug('page referrer', {referrer});
    const windowButtonsVisibleRef = useRef<boolean | null>(null);
        useEffect(() => {
        if (!isMac) {
            return;
        }

        const isVideo = !!video && !MediaUtil.isAudio(video.fileName);
        if (!isVideo) {
            playerApi.setWindowButtonsVisibility(true).then();
            windowButtonsVisibleRef.current = true;
            return;
        }

        const setVisible = (visible: boolean) => {
            if (windowButtonsVisibleRef.current === visible) {
                return;
            }
            windowButtonsVisibleRef.current = visible;
            playerApi.setWindowButtonsVisibility(visible).then();
        };

        if (showSideBar) {
            setVisible(true);
            return;
        }

        const HOT_ZONE_WIDTH_PX = 480;
        const HOT_ZONE_HEIGHT_PX = 160;
        const HIDE_DELAY_MS = 250;

        let hideTimeout: NodeJS.Timeout | null = null;
        const scheduleHide = () => {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
            }
            hideTimeout = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
        };

        const onMouseMove = (e: MouseEvent) => {
            const nearTrafficLights = e.clientX <= HOT_ZONE_WIDTH_PX && e.clientY <= HOT_ZONE_HEIGHT_PX;
            if (nearTrafficLights) {
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                    hideTimeout = null;
                }
                setVisible(true);
            } else {
                scheduleHide();
            }
        };

        setVisible(false);
        window.addEventListener('mousemove', onMouseMove);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            if (hideTimeout) {
                clearTimeout(hideTimeout);
            }
            setVisible(true);
        };
    }, [isMac, showSideBar, uiFullScreen, video, windowState]);
    useEffect(() => {
        /**
         * 应用轻量播放详情，并优先把视频源写入播放器状态。
         */
        const runEffect = () => {
            logger.debug('video effect triggered', {video});
            if (!video) {
                // 菜单页与播放器共用同一页面实例，离开播放器时必须清理旧媒体上下文，
                // 否则返回同一个视频时路径和 videoId 不变，播放器不会重新触发 ready。
                usePlaybackSession.getState().clear();
                useSubtitleTranslation.getState().clearTranslations();
                playerActions.clearSubtitles();
                playerActions.setSource(null);
                return;
            }
            const previousVideoId = usePlaybackSession.getState().videoId;
            usePlaybackSession.setState({videoId: video.id});
            const vp = usePlaybackSession.getState().videoPath;
            const videoPath = PathUtil.join(video.basePath, video.fileName);
            if (previousVideoId !== video.id) {
                usePlaybackSession.setState({
                    subtitlePath: null,
                    srtHash: null,
                    subtitleSessionId: null,
                });
                // 整句学习会话绑定在具体视频与字幕缓存上，换片必须结束，否则会检索到上一部片的字幕
                useChatPanel.getState().clear();
            }
            if (videoPath && vp !== videoPath) {
                usePlaybackSession.getState().updateFile(videoPath);
            }


            if (video) {
                const mediaType: 'audio' | 'video' = MediaUtil.isAudio(video.fileName) ? 'audio' : 'video';
                if (video.podcastModeUserSet) {
                    // 用户手动选择过：直接应用选择，不再自动切换
                    useLayout.getState().setPodcastMode(video.podcastModeManual ?? false);
                } else {
                    // 没有用户偏好：首次打开音频自动进播客模式，视频自动回普通模式
                    if (mediaType === 'audio') {
                        const currentMode = useLayout.getState().podcastMode;
                        if (!currentMode) {
                            useLayout.getState().setPodcastMode(true);
                            toast(
                                (t: Toast) => (
                                    <ModeSwitchToast
                                        mode="podcast"
                                        onCancel={() => {
                                            useLayout.getState().setPodcastMode(false);
                                            void playerApi.setPodcastModePreference(video.id, false);
                                            void swrMutate(SWR_KEY.PLAYER_P);
                                            toast.dismiss(t.id);
                                        }}
                                    />
                                ),
                                {
                                    id: MODE_SWITCH_TOAST_ID,
                                    duration: 5000,
                                }
                            );
                        }
                    } else {
                        const currentMode = useLayout.getState().podcastMode;
                        if (currentMode) {
                            useLayout.getState().setPodcastMode(false);
                            toast(
                                (t: Toast) => (
                                    <ModeSwitchToast
                                        mode="video"
                                        onCancel={() => {
                                            useLayout.getState().setPodcastMode(true);
                                            void playerApi.setPodcastModePreference(video.id, true);
                                            void swrMutate(SWR_KEY.PLAYER_P);
                                            toast.dismiss(t.id);
                                        }}
                                    />
                                ),
                                {
                                    id: MODE_SWITCH_TOAST_ID,
                                    duration: 5000,
                                }
                            );
                        }
                    }
                }
            }
        };
        runEffect();
    }, [video]);
    // dev/qa 入口：视频就绪后跳到 `?seek=` 指定的位置（打包版 seekSeconds 恒为 null）
    useEffect(() => {
        if (devEntry.seekSeconds === null || !videoLoaded) {
            return;
        }
        playerActions.seekTo({ time: devEntry.seekSeconds, play: false });
    }, [devEntry.seekSeconds, videoLoaded]);
    useEffect(() => {
        let cancelled = false;

        /**
         * 在当前视频完成 ready、恢复进度并发出播放指令后，再匹配和解析字幕。
         *
         * 同时校验 store 中的实时状态，避免切换视频时沿用上一条记录的
         * `videoLoaded` 快照，导致新视频尚未 ready 就开始解析字幕。
         */
        const loadSubtitleAfterVideoReady = async () => {
            if (!video || !videoLoaded) {
                return;
            }

            const videoPath = PathUtil.join(video.basePath, video.fileName);
            const fileState = usePlaybackSession.getState();
            if (
                !fileState.videoLoaded
                || fileState.videoId !== video.id
                || fileState.videoPath !== videoPath
            ) {
                return;
            }

            try {
                const resolution = await playerApi.getPlayerSubtitle(video.id);
                const latestFileState = usePlaybackSession.getState();
                if (
                    cancelled
                    || !latestFileState.videoLoaded
                    || latestFileState.videoId !== video.id
                    || latestFileState.videoPath !== videoPath
                ) {
                    return;
                }
                if (resolution.subtitlePath) {
                    logger.info('player subtitle resolved', {
                        videoId: video.id,
                        subtitlePath: resolution.subtitlePath,
                        videoPath,
                        mismatchSuspected: resolution.mismatchSuspected,
                    });
                    latestFileState.updateFile(resolution.subtitlePath);
                } else {
                    logger.info('player subtitle not found', {
                        videoId: video.id,
                        videoPath,
                    });
                    latestFileState.clearSrt();
                }
            } catch (error) {
                logger.error('failed to resolve player subtitle', {
                    error: error instanceof Error ? error.message : String(error),
                    videoId: video.id,
                });
            }
        };
        loadSubtitleAfterVideoReady().then();
        return () => {
            cancelled = true;
        };
    }, [video, videoLoaded]);
    // 只补充 sideBarAnimation，保留 URL 上已有的参数（如 dev/qa 的 `?file=`）
    useEffect(() => {
        setSearchParams((prev) => {
            if (prev.get('sideBarAnimation') === 'true') {
                return prev;
            }
            const next = new URLSearchParams(prev);
            next.set('sideBarAnimation', 'true');
            return next;
        });
    }, [setSearchParams]);
    return (
        <div className={cn('relative w-full h-full flex flex-row overflow-hidden bg-background')}>
            {showSideBar && (
                <div className="shrink-0 h-full z-20">
                    <SideBar compact={!w('xl')} />
                </div>
            )}
            <div className="flex-1 h-full w-full relative overflow-hidden">
                <PlaybackLayout />
            </div>
            {/* 播放类快捷键在学习页打开期间停用（见 PlayerShortcut）；控制面板与字幕列表保持可用 */}
            <ControlButton />
            <PlayerShortcut />
        </div>
    );
};

export default PlayerWithControlsPage;
