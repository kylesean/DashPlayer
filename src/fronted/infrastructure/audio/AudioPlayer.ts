import StrUtil from '@/common/utils/str-util';
import UrlUtil from '@/common/utils/UrlUtil';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type { Nullable } from '@/common/types/Types';
import { TypeGuards } from '@/common/utils/TypeGuards';
import { getRendererLogger } from '@/fronted/log/simple-logger';

const api = backendClient;
const cache = new Map<string, string>();
let player: HTMLAudioElement | null = null;
let segmentCleanup: (() => void) | null = null;
let playbackEpoch = 0;

/**
 * 清除渲染层 TTS URL 内存缓存（在设置页切换音色后调用，确保立即听到新音色）。
 */
export const clearTtsAudioCache = (): void => {
    cache.clear();
};

export const stopActiveAudio = () => {
    playbackEpoch += 1;
    player?.pause();
    player = null;
    if (segmentCleanup) {
        segmentCleanup();
        segmentCleanup = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
};

export const playAudioUrl = async (audioUrl: Nullable<string>) => {
    if (TypeGuards.isNull(audioUrl)) {
        return;
    }
    stopActiveAudio();
    const epoch = playbackEpoch;
    getRendererLogger('AudioPlayer').debug('play audio url', { audioUrl });
    const nextPlayer = new Audio(audioUrl);
    nextPlayer.volume = 0.5;
    if (epoch !== playbackEpoch) {
        return;
    }
    player = nextPlayer;
    await nextPlayer.play();
};

/**
 * 直接从原视频流式播放指定时间区间的原生音频（无需切割物理视频片段）。
 */
export const playMediaSegment = (
    videoPath: string,
    startTime: number,
    endTime?: number,
): Promise<void> => {
    const url = UrlUtil.toUrl(videoPath);
    if (!url || !Number.isFinite(startTime) || startTime < 0) {
        return Promise.reject(new Error('Invalid media segment'));
    }

    stopActiveAudio();

    return new Promise<void>((resolve, reject) => {
        const media = document.createElement('video');
        media.preload = 'auto';
        media.muted = false;
        media.volume = 0.85;
        media.setAttribute('playsinline', 'true');
        media.src = url;

        const safeStart = Math.max(0, startTime);
        const effectiveEnd =
            typeof endTime === 'number' && Number.isFinite(endTime) && endTime > safeStart
                ? endTime + 0.12
                : safeStart + 6;
        const maxDurationMs = Math.max(2000, (effectiveEnd - safeStart + 2) * 1000);

        let settled = false;
        let playbackStarted = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            media.removeEventListener('loadedmetadata', onLoadedMetadata);
            media.removeEventListener('seeked', onSeeked);
            media.removeEventListener('timeupdate', onTimeUpdate);
            media.removeEventListener('ended', onComplete);
            media.removeEventListener('error', onError);
            media.pause();
            media.removeAttribute('src');
            media.load();
            if (segmentCleanup === abortAsStopped) {
                segmentCleanup = null;
            }
        };

        const finishResolve = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };

        const finishReject = (err: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };

        const abortAsStopped = () => {
            finishResolve();
        };

        const startPlayback = () => {
            if (settled || playbackStarted) return;
            playbackStarted = true;
            timeoutId = setTimeout(finishResolve, maxDurationMs);
            void media.play().catch(finishReject);
        };

        const onLoadedMetadata = () => {
            if (settled) return;
            if (safeStart > 0.05) {
                media.currentTime = safeStart;
            } else {
                startPlayback();
            }
        };

        const onSeeked = () => {
            startPlayback();
        };

        const onTimeUpdate = () => {
            if (!settled && media.currentTime >= effectiveEnd) {
                finishResolve();
            }
        };

        const onComplete = () => {
            finishResolve();
        };

        const onError = () => {
            finishReject(new Error('Failed to load native media segment'));
        };

        segmentCleanup = abortAsStopped;
        media.addEventListener('loadedmetadata', onLoadedMetadata);
        media.addEventListener('seeked', onSeeked);
        media.addEventListener('timeupdate', onTimeUpdate);
        media.addEventListener('ended', onComplete);
        media.addEventListener('error', onError);
    });
};

/**
 * 优先播放原视频片段中的原生人声；若无有效视频路径/时间戳或播放失败，则自动回退到 TTS。
 */
export const playContextAudio = async (options: {
    text: string;
    videoPath?: string;
    startTime?: number;
    endTime?: number;
}): Promise<'native' | 'tts'> => {
    const { text, videoPath, startTime, endTime } = options;
    stopActiveAudio();
    const epoch = playbackEpoch;
    if (videoPath && typeof startTime === 'number' && Number.isFinite(startTime)) {
        try {
            await playMediaSegment(videoPath, startTime, endTime);
            return 'native';
        } catch (error) {
            if (epoch !== playbackEpoch) {
                return 'native';
            }
            getRendererLogger('AudioPlayer').warn('native media segment fallback to tts', {
                videoPath,
                startTime,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    try {
        const url = await getTtsUrl(text);
        // await 期间若已有新一轮播放或 stopActiveAudio，直接丢弃迟到回退播放
        if (epoch !== playbackEpoch) {
            return 'tts';
        }
        if (url) {
            await playAudioUrl(url);
        } else {
            await playWord(text);
        }
    } catch {
        if (epoch === playbackEpoch) {
            await playWord(text);
        }
    }
    return 'tts';
};

/**
 * 使用浏览器内置语音朗读单词，作为 sherpa 离线 TTS 不可用时的回退。
 *
 * @param word 待朗读的英文单词。
 */
export const playWord = async (word: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        getRendererLogger('AudioPlayer').debug('speech synthesis unavailable');
        return;
    }
    stopActiveAudio();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
};

export const getTtsUrl = async (str: string) => {
    str = str.trim();
    if (StrUtil.isBlank(str)) {
        return;
    }
    let audioUrl = cache.get(str);
    if (audioUrl) {
        return audioUrl;
    }

    try {
        audioUrl = await api.call('ai-func/tts', str);
        getRendererLogger('AudioPlayer').debug('tts result', { audioUrl });
    } catch (error) {
        getRendererLogger('AudioPlayer').warn('tts failed', { error });
        return;
    }

    if (!StrUtil.isBlank(audioUrl)) {
        cache.set(str, audioUrl);
        return audioUrl;
    }
    return;
};
