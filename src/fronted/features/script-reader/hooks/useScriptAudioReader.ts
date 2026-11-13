import { useCallback, useEffect, useRef, useState } from 'react';

import type { Sentence } from '@/common/types/SentenceC';
import { playContextAudio, stopActiveAudio } from '@/fronted/infrastructure/audio/AudioPlayer';

export type ScriptPlaybackRate = 0.75 | 1 | 1.25;

interface UseScriptAudioReaderParams {
    videoId?: string;
    videoPath?: string;
    sentences: readonly Sentence[];
    onSentenceFocus?: (sentenceIndex: number) => void;
}

/**
 * 精读文稿连续伴读控制器。
 *
 * 支持点击任意句子起播、播完自动连读下一句、单句循环与倍速调节；
 * 通过 docScoped 状态与 epochRef 保证切换文稿或离开页面时安全停播，无需在 effect 中同步 setState。
 */
export function useScriptAudioReader({
    videoId,
    videoPath,
    sentences,
    onSentenceFocus,
}: UseScriptAudioReaderParams) {
    const [activeCursor, setActiveCursor] = useState<{ videoId?: string; index: number | null }>({
        videoId,
        index: null,
    });
    const [playingState, setPlayingState] = useState<{ videoId?: string; playing: boolean }>({
        videoId,
        playing: false,
    });
    const [autoAdvance, setAutoAdvance] = useState(true);
    const [singleLoop, setSingleLoop] = useState(false);
    const [playbackRate, setPlaybackRate] = useState<ScriptPlaybackRate>(1);

    const epochRef = useRef(0);
    const sentencesRef = useRef(sentences);
    const autoAdvanceRef = useRef(autoAdvance);
    const singleLoopRef = useRef(singleLoop);
    const rateRef = useRef(playbackRate);
    const videoIdRef = useRef(videoId);
    const videoPathRef = useRef(videoPath);
    const onFocusRef = useRef(onSentenceFocus);

    useEffect(() => {
        sentencesRef.current = sentences;
        autoAdvanceRef.current = autoAdvance;
        singleLoopRef.current = singleLoop;
        rateRef.current = playbackRate;
        videoIdRef.current = videoId;
        videoPathRef.current = videoPath;
        onFocusRef.current = onSentenceFocus;
    });

    const activeSentenceIndex = activeCursor.videoId === videoId ? activeCursor.index : null;
    const isPlaying = playingState.videoId === videoId ? playingState.playing : false;

    const setActiveSentenceIndex = useCallback((index: number | null) => {
        setActiveCursor({ videoId: videoIdRef.current, index });
    }, []);

    const stop = useCallback(() => {
        epochRef.current += 1;
        stopActiveAudio();
        setPlayingState({ videoId: videoIdRef.current, playing: false });
    }, []);

    // 切换文稿或卸载页面时清理底层音频句柄
    useEffect(() => () => {
        epochRef.current += 1;
        stopActiveAudio();
    }, [videoId]);

    const runLoopFromPosition = useCallback(async (startPos: number, epoch: number, docId?: string) => {
        let cursor = startPos;
        while (epochRef.current === epoch) {
            const list = sentencesRef.current;
            const current = list[cursor];
            if (!current) {
                break;
            }
            setActiveCursor({ videoId: docId, index: current.index });
            onFocusRef.current?.(current.index);

            try {
                await playContextAudio({
                    text: current.text,
                    videoPath: videoPathRef.current,
                    startTime: current.adjustedStart ?? current.start,
                    endTime: current.adjustedEnd ?? current.end,
                    playbackRate: rateRef.current,
                    waitForEnd: true,
                });
            } catch {
                // 单句播放失败时若未被用户中止，继续推进或安全退出
            }

            if (epochRef.current !== epoch) {
                return;
            }
            if (singleLoopRef.current) {
                continue;
            }
            if (!autoAdvanceRef.current) {
                break;
            }
            cursor += 1;
        }
        if (epochRef.current === epoch) {
            setPlayingState({ videoId: docId, playing: false });
        }
    }, []);

    const playFromSentenceIndex = useCallback((sentenceIndex: number) => {
        const list = sentencesRef.current;
        const pos = list.findIndex((item) => item.index === sentenceIndex);
        if (pos < 0) {
            return;
        }
        const docId = videoIdRef.current;
        const nextEpoch = epochRef.current + 1;
        epochRef.current = nextEpoch;
        setActiveCursor({ videoId: docId, index: sentenceIndex });
        setPlayingState({ videoId: docId, playing: true });
        void runLoopFromPosition(pos, nextEpoch, docId);
    }, [runLoopFromPosition]);

    const togglePlayPause = useCallback(() => {
        if (isPlaying) {
            stop();
            return;
        }
        const list = sentencesRef.current;
        if (list.length === 0) return;
        const targetIndex =
            activeSentenceIndex !== null && list.some((s) => s.index === activeSentenceIndex)
                ? activeSentenceIndex
                : list[0].index;
        playFromSentenceIndex(targetIndex);
    }, [isPlaying, activeSentenceIndex, stop, playFromSentenceIndex]);

    const stepSentence = useCallback((delta: -1 | 1) => {
        const list = sentencesRef.current;
        if (list.length === 0) return;
        const currentPos = activeSentenceIndex === null
            ? -1
            : list.findIndex((s) => s.index === activeSentenceIndex);
        const nextPos = currentPos < 0
            ? (delta > 0 ? 0 : list.length - 1)
            : Math.min(list.length - 1, Math.max(0, currentPos + delta));
        const target = list[nextPos];
        if (target) {
            playFromSentenceIndex(target.index);
        }
    }, [activeSentenceIndex, playFromSentenceIndex]);

    const changePlaybackRate = useCallback((rate: ScriptPlaybackRate) => {
        rateRef.current = rate;
        setPlaybackRate(rate);
        if (isPlaying && activeSentenceIndex !== null) {
            playFromSentenceIndex(activeSentenceIndex);
        }
    }, [isPlaying, activeSentenceIndex, playFromSentenceIndex]);

    return {
        activeSentenceIndex,
        setActiveSentenceIndex,
        isPlaying,
        autoAdvance,
        setAutoAdvance,
        singleLoop,
        setSingleLoop,
        playbackRate,
        setPlaybackRate: changePlaybackRate,
        playFromSentenceIndex,
        togglePlayPause,
        stepSentence,
        stop,
    };
}
