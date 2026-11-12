import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { UseSpeechRecognitionReturn } from '@astryxdesign/core/Chat';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { chatApi } from '@/fronted/features/chat/chatApi';
import { getRendererLogger } from '@/fronted/log/simple-logger';

const logger = getRendererLogger('WhisperDictation');

const EMPTY_BANDS = [0, 0, 0, 0, 0];

const sanitizeDictationError = (raw: string): string => {
    const stripped = raw
        .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
        .trim();
    if (/parakeet_model_load|Segments\s*\(0\)/i.test(stripped)) {
        return /parakeet/i.test(stripped)
            ? '未识别到清晰英语语音（Parakeet 模型仅支持英文输入）'
            : '未识别到清晰语音，请靠近麦克风重试';
    }
    return stripped.split('\n')[0]?.slice(0, 160) || '语音识别失败';
};

const pickSupportedMimeType = (): string => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', ''];
    for (const mime of candidates) {
        if (!mime || (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime))) {
            return mime;
        }
    }
    return '';
};

export interface WhisperDictationResult extends UseSpeechRecognitionReturn {
    isTranscribing: boolean;
    errorText: string | null;
}

/**
 * 将本地麦克风录音 + Web Audio 实时频段采样 + 离线 Whisper/Parakeet ASR 转写
 * 适配为 Astryx `ChatDictationButton` 所需的 `UseSpeechRecognitionReturn` 契约。
 */
export function useWhisperDictation(options: {
    onTranscriptReady: (text: string) => void;
    onError?: (message: string) => void;
}): WhisperDictationResult {
    const { onTranscriptReady, onError } = options;
    const { data: resourceStatus } = useSWR(
        'settings/resource-status/detail',
        () => settingsApi.getResourceStatus(),
    );
    const asrReady = resourceStatus?.transcription?.ready ?? false;
    const hasMediaRecorder = typeof navigator !== 'undefined'
        && Boolean(navigator.mediaDevices?.getUserMedia)
        && typeof MediaRecorder !== 'undefined';

    const [isListening, setIsListening] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [volume, setVolume] = useState(0);
    const [bands, setBands] = useState<number[]>(EMPTY_BANDS);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [errorText, setErrorText] = useState<string | null>(null);

    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const rafRef = useRef<number | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const abortedRef = useRef(false);

    const cleanupAudio = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (audioCtxRef.current) {
            void audioCtxRef.current.close().catch(() => undefined);
            audioCtxRef.current = null;
        }
        setIsListening(false);
        setIsSpeaking(false);
        setVolume(0);
        setBands(EMPTY_BANDS);
    }, []);

    useEffect(() => () => {
        abortedRef.current = true;
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        }
        cleanupAudio();
    }, [cleanupAudio]);

    const start = useCallback(() => {
        if (!hasMediaRecorder || !asrReady || isListening || isTranscribing) {
            return;
        }
        abortedRef.current = false;
        setErrorText(null);
        setInterimTranscript('');

        void (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (abortedRef.current) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                chunksRef.current = [];

                const mimeType = pickSupportedMimeType();
                const recorder = mimeType
                    ? new MediaRecorder(stream, { mimeType })
                    : new MediaRecorder(stream);
                recorderRef.current = recorder;

                recorder.ondataavailable = (ev) => {
                    if (ev.data.size > 0) {
                        chunksRef.current.push(ev.data);
                    }
                };

                recorder.onstop = () => {
                    const recordedChunks = [...chunksRef.current];
                    const wasAborted = abortedRef.current;
                    cleanupAudio();
                    recorderRef.current = null;

                    if (wasAborted || recordedChunks.length === 0) {
                        return;
                    }
                    void (async () => {
                        setIsTranscribing(true);
                        setInterimTranscript('正在识别语音…');
                        try {
                            const blob = new Blob(recordedChunks, { type: mimeType || 'audio/webm' });
                            const bytes = new Uint8Array(await blob.arrayBuffer());
                            const { text } = await chatApi.transcribeAudio({ audio: bytes });
                            const clean = text.trim();
                            setInterimTranscript('');
                            if (clean) {
                                onTranscriptReady(clean);
                            }
                        } catch (err) {
                            const rawMsg = err instanceof Error ? err.message : String(err);
                            const cleanMsg = sanitizeDictationError(rawMsg);
                            logger.error('voice dictation transcription failed', { error: cleanMsg });
                            setErrorText(cleanMsg);
                            setInterimTranscript('');
                            // 注意：chat/transcribe-audio 走 IPC registerRoute，异常已由主进程 RendererEvents.error
                            // 触发统一全局错误提示；这里不再重复调用 onError，避免同一失败叠出两个错误框。
                        } finally {
                            setIsTranscribing(false);
                        }
                    })();
                };

                // 频段电平采样供 ChatDictationButton 动画均衡条响应真实音量
                const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
                if (AudioCtx) {
                    const ctx = new AudioCtx();
                    audioCtxRef.current = ctx;
                    const source = ctx.createMediaStreamSource(stream);
                    const analyser = ctx.createAnalyser();
                    analyser.fftSize = 64;
                    source.connect(analyser);
                    const freqData = new Uint8Array(analyser.frequencyBinCount);

                    const tick = () => {
                        if (!streamRef.current) return;
                        analyser.getByteFrequencyData(freqData);
                        const nextBands = [0, 1, 2, 3, 4].map((bandIdx) => {
                            const startBin = bandIdx * 4;
                            let sum = 0;
                            for (let j = 0; j < 4; j += 1) {
                                sum += freqData[startBin + j] ?? 0;
                            }
                            return Math.min(1, sum / (4 * 200));
                        });
                        const avg = nextBands.reduce((a, b) => a + b, 0) / nextBands.length;
                        setBands(nextBands);
                        setVolume(avg);
                        setIsSpeaking(avg > 0.08);
                        rafRef.current = requestAnimationFrame(tick);
                    };
                    rafRef.current = requestAnimationFrame(tick);
                }

                recorder.start(250);
                setIsListening(true);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error('microphone start failed', { error: msg });
                setErrorText(msg);
                onError?.(msg);
                cleanupAudio();
            }
        })();
    }, [asrReady, cleanupAudio, hasMediaRecorder, isListening, isTranscribing, onError, onTranscriptReady]);

    const stop = useCallback(() => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        } else {
            cleanupAudio();
        }
    }, [cleanupAudio]);

    const abort = useCallback(() => {
        abortedRef.current = true;
        setInterimTranscript('');
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        } else {
            cleanupAudio();
        }
    }, [cleanupAudio]);

    const toggle = useCallback(() => {
        if (isListening) {
            stop();
        } else {
            start();
        }
    }, [isListening, start, stop]);

    return {
        isSupported: hasMediaRecorder && asrReady,
        isListening,
        isSpeaking,
        volume,
        bands,
        rawBands: bands,
        interimTranscript,
        start,
        stop,
        abort,
        toggle,
        isTranscribing,
        errorText,
    };
}
