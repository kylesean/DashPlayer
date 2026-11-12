/**
 * 负责把文件状态、字幕解析、播放历史和播放器 store 串起来。
 */
import { useCallback, useEffect, useRef } from 'react';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import StrUtil from '@/common/utils/str-util';
import UrlUtil from '@/common/utils/UrlUtil';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { computeResumeTime } from '@/fronted/features/player/lib/playerResume';
import { playerApi } from '@/fronted/features/player/playerApi';
import useTranslation from '@/fronted/features/player/translationStore';
import { useVocabularyStore } from '@/fronted/features/player/vocabularyStore';
import useSetting from '@/fronted/features/settings/settingsStore';

const logger = getRendererLogger('usePlayerBridge');

async function waitForPlayerDuration(
    isSessionActive: () => boolean,
    timeoutMs = 1500,
): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (!isSessionActive()) return 0;
        const d = usePlayer.getState().duration;
        if (d > 0) return d;
        await new Promise((r) => setTimeout(r, 50));
    }
    return usePlayer.getState().duration;
}

/**
 * 绑定播放器所需的外部副作用，并返回页面层直接使用的桥接事件。
 */
export function usePlayerBridge(navigate: (path: string) => void) {
    const videoPath = usePlaybackSession((s) => s.videoPath);
    const subtitlePath = usePlaybackSession((s) => s.subtitlePath);
    const srtHash = usePlaybackSession((s) => s.srtHash);
    const subtitleSessionId = usePlaybackSession((s) => s.subtitleSessionId);
    const videoId = usePlaybackSession((s) => s.videoId);
    /** 字幕重载令牌；时间戳校准等改动由控制按钮递增，触发字幕上下文重建。 */
    const subtitleReloadToken = usePlaybackSession((s) => s.subtitleReloadToken);

    const lastLoadedFileRef = useRef<string | undefined>(undefined);
    const inFlightFileRef = useRef<string | undefined>(undefined);

    useEffect(() => {
        lastLoadedFileRef.current = undefined;
        inFlightFileRef.current = undefined;
    }, [videoPath]);

    useEffect(() => {
        if (StrUtil.isBlank(videoPath)) {
            playerActions.setSource(null);
            return;
        }
        const fileUrl = UrlUtil.toUrl(videoPath!);
        playerActions.setSource(fileUrl);
    }, [videoPath]);

    useEffect(() => {
        let cancelled = false;
        /**
         * 按当前字幕路径重建前端字幕上下文。
         *
         * 行为说明：
         * - 切换字幕时先清空旧字幕与旧翻译上下文，避免旧句子继续触发懒加载副作用。
         * - 新字幕解析成功后，先激活新的 fileHash，再加载字幕，确保依赖当前句子的副作用看到的是一致上下文。
         */
        const loadSubtitles = async () => {
            useVocabularyStore.getState().clearVocabularyWords();
            const currentVideoId = videoId;
            if (StrUtil.isBlank(currentVideoId)) {
                return;
            }
            // 先清掉上一视频残留的字幕哈希与翻译上下文，避免旧状态继续生效。
            usePlaybackSession.setState({
                srtHash: null,
                subtitleSessionId: null,
            });
            useTranslation.getState().setActiveFileHash(null);
            playerActions.clearSubtitles();
            const currentPath = StrUtil.isBlank(subtitlePath) ? null : subtitlePath!;
            const playbackSessionId = crypto.randomUUID();
            logger.info('subtitle parsing started', {
                videoId: currentVideoId,
                subtitlePath: currentPath,
                playbackSessionId,
            });
            try {
                const result = await playerApi.parseSubtitleToSentences({
                    subtitlePath: currentPath,
                    videoId: currentVideoId!,
                    playbackSessionId,
                });
                if (
                    cancelled
                    || currentPath !== usePlaybackSession.getState().subtitlePath
                    || currentVideoId !== usePlaybackSession.getState().videoId
                ) {
                    return;
                }
                if (!result) {
                    usePlaybackSession.setState({ subtitlePath: null });
                    useTranslation.getState().setActiveFileHash(null);
                    playerActions.clearSubtitles();
                    return;
                }
                usePlaybackSession.setState({
                    srtHash: result.fileHash,
                    subtitleSessionId: playbackSessionId,
                });
                useTranslation.getState().setActiveFileHash(result.fileHash);
                playerActions.loadSubtitles(result.sentences);
                logger.info('subtitle parsing completed', {
                    videoId: currentVideoId,
                    subtitlePath: currentPath,
                    fileHash: result.fileHash,
                    sentenceCount: result.sentences.length,
                    playbackSessionId,
                });
            } catch (error) {
                logger.error('failed to load subtitles', { error: error instanceof Error ? error.message : String(error) });
            }
        };

        loadSubtitles().then();
        return () => {
            cancelled = true;
        };
    }, [subtitlePath, videoId, videoPath, subtitleReloadToken]);


    useEffect(() => {
        let cancelled = false;

        /**
         * 在字幕已经交给播放器后，独立匹配当前字幕中出现的用户生词。
         *
         * 结果必须与当前字幕哈希一致，避免切换视频后旧任务覆盖新页面。
         */
        const loadVocabulary = async () => {
            if (
                StrUtil.isBlank(srtHash)
                || StrUtil.isBlank(subtitleSessionId)
                || StrUtil.isBlank(videoId)
            ) {
                return;
            }

            const currentFileHash = srtHash!;
            const currentSessionId = subtitleSessionId!;
            const currentVideoId = videoId!;
            try {
                const result = await playerApi.matchSubtitleVocabulary({
                    fileHash: currentFileHash,
                    videoId: currentVideoId,
                    playbackSessionId: currentSessionId,
                });
                if (
                    cancelled
                    || result.cancelled
                    || result.videoId !== currentVideoId
                    || result.playbackSessionId !== currentSessionId
                    || result.fileHash !== currentFileHash
                    || usePlaybackSession.getState().srtHash !== currentFileHash
                    || usePlaybackSession.getState().subtitleSessionId !== currentSessionId
                    || usePlaybackSession.getState().videoId !== currentVideoId
                ) {
                    return;
                }
                useVocabularyStore.getState().setVocabularyStates(result.wordStates ?? {});
            } catch (error) {
                logger.error('failed to match subtitle vocabulary', {
                    error: error instanceof Error ? error.message : String(error),
                    fileHash: currentFileHash,
                });
            }
        };

        loadVocabulary().then();
        return () => {
            cancelled = true;
        };
    }, [srtHash, subtitleSessionId, videoId]);

    useEffect(() => {
        if (!videoId) return;
        let stopped = false;
        let counter = 0;
        // 上次上报的位置与播放状态；用于判断是否真的需要上报，避免暂停期间每 5 秒空刷日志。
        let lastReportedPosition = -1;
        let lastReportedPlaying: boolean | null = null;
        /**
         * 定时上报播放进度：仅当位置变化超过 1 秒或播放/暂停状态切换时才上报，
         * 正常播放保持每 5 秒一次的节奏，暂停/位置不变时零上报。
         */
        const tick = async () => {
            if (stopped) return;
            try {
                if (usePlaybackSession.getState().videoLoaded) {
                    const file = usePlaybackSession.getState().videoPath;
                    if (StrUtil.isNotBlank(file)) {
                        counter += 1;
                        if (counter % 5 === 0) {
                            const playTime = usePlayer.getState().internal.exactPlayTime;
                            const playing = usePlayer.getState().playing;
                            const positionMoved = Math.abs(playTime - lastReportedPosition) >= 1;
                            const stateChanged = playing !== lastReportedPlaying;
                            if (positionMoved || stateChanged) {
                                lastReportedPosition = playTime;
                                lastReportedPlaying = playing;
                                await playerApi.updateProgress({
                                    file,
                                    currentPosition: playTime
                                });
                            }
                        }
                    }
                }
            } catch (error) {
                logger.error('failed to update watch history progress', { error: error instanceof Error ? error.message : String(error) });
            } finally {
                setTimeout(tick, 1000);
            }
        };
        tick();
        return () => {
            stopped = true;
        };
    }, [videoId]);

    /**
     * PlayerEngine 的 onReady 回调（canplay 事件）：恢复播放进度并把视频标记为已加载。
     *
     * onReady 在每次 seek/缓冲完成后都会重放（训练模式连续 seek 时可达每秒数次），
     * 靠 lastLoadedFileRef 幂等去重；守卫命中是常规路径，只在 debug 级留下痕迹。
     */
    const handlePlayerReady = useCallback(async () => {
        const file = usePlaybackSession.getState().videoPath;
        const currentVideoId = usePlaybackSession.getState().videoId;
        logger.debug('player ready callback entered', {
            videoId: currentVideoId,
            videoPath: file,
            lastLoadedFile: lastLoadedFileRef.current,
            videoLoaded: usePlaybackSession.getState().videoLoaded,
        });
        if (StrUtil.isBlank(file) || StrUtil.isBlank(currentVideoId)) {
            logger.warn('player ready callback skipped: missing file context', {
                videoId: currentVideoId,
                videoPath: file,
            });
            return;
        }
        if (lastLoadedFileRef.current === file || inFlightFileRef.current === file) {
            return;
        }
        inFlightFileRef.current = file;
        const isSessionActive = () =>
            usePlaybackSession.getState().videoPath === file
            && usePlaybackSession.getState().videoId === currentVideoId;
        try {
            const result = await playerApi.getPlayerDetail(currentVideoId);
            if (!isSessionActive()) {
                return;
            }
            const progress = result?.current_position ?? 0;
            const duration = await waitForPlayerDuration(isSessionActive);
            if (!isSessionActive()) {
                return;
            }
            const resumeTime = computeResumeTime({ progress, duration });
            logger.debug('jumping to history progress', { progress, duration, resumeTime });

            if (resumeTime === 0 && progress > 0) {
                await playerApi.updateProgress({ file, currentPosition: 0 });
                if (!isSessionActive()) {
                    return;
                }
            }

            // 首次加载要把播放头定位到上次进度并起播；seekTo 默认保持播放态，
            // 所以这里必须显式 play: true，否则新打开的会话会停在暂停。
            playerActions.seekTo({ time: resumeTime, play: true });
            lastLoadedFileRef.current = file;
        } catch (error) {
            logger.error('failed to jump to history progress', { error: error instanceof Error ? error.message : String(error) });
        } finally {
            if (inFlightFileRef.current === file) {
                inFlightFileRef.current = undefined;
            }
        }
        if (!isSessionActive()) {
            return;
        }
        usePlaybackSession.getState().loadedVideo(file);
        logger.info('player ready callback completed', {
            videoId: currentVideoId,
            videoPath: file,
            videoLoaded: usePlaybackSession.getState().videoLoaded,
        });
    }, []);

    const handleAutoPlayNext = useCallback(async () => {
        const currentVideoId = usePlaybackSession.getState().videoId;
        // 单一来源：设置库里的值，而不是播放器 store 的镜像字段。
        // 镜像字段在重启后恒为 false，会让用户开关看起来失效。
        const autoPlayNext = useSetting.getState().values.get('player.autoPlayNext') === 'true';
        if (!autoPlayNext || !currentVideoId) {
            return;
        }
        try {
            const nextVideo = await playerApi.getNextVideo(currentVideoId);
            if (nextVideo) {
                logger.info('auto playing next video', { fileName: nextVideo.fileName });
                navigate(`/player/${nextVideo.id}`);
            } else {
                logger.debug('no next video found');
            }
        } catch (error) {
            logger.error('failed to get next video', { error: error instanceof Error ? error.message : String(error) });
        }
    }, [navigate]);

    return {
        handlePlayerReady,
        handleAutoPlayNext
    };
}
