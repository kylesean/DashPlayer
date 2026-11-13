import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { UseSpeechRecognitionReturn } from '@astryxdesign/core/Chat';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { chatApi } from '@/fronted/features/chat/chatApi';
import { getRendererLogger } from '@/fronted/log/simple-logger';

const logger = getRendererLogger('WhisperDictation');

const EMPTY_BANDS = [0, 0, 0, 0, 0];

const sanitizeDictationError = (raw: string, hasSenseVoice: boolean): string => {
    const stripped = raw
        .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
        .trim();
    if (/parakeet_model_load|Segments\s*\(0\)/i.test(stripped)) {
        if (/parakeet/i.test(stripped) || !hasSenseVoice) {
            return '当前仅安装了英文 Parakeet 模型，未识别到英语语音；如需中文/中英混说输入，请在「设置 → 资源与模型 → 扩展模型」下载「中英双语对话语音输入」。';
        }
        return '未识别到清晰语音，请靠近麦克风重试';
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

export type WhisperDictationPhase = 'idle' | 'requesting' | 'listening' | 'transcribing';

export interface WhisperDictationResult extends UseSpeechRecognitionReturn {
    phase: WhisperDictationPhase;
    isRequesting: boolean;
    isTranscribing: boolean;
    isBusy: boolean;
    errorText: string | null;
}

/**
 * 将本地麦克风录音 + Web Audio 实时频段采样 + 离线语音识别（优先 SenseVoice 中英双语，回退 Parakeet/Whisper）
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
    const { data: senseVoiceStatus } = useSWR(
        'sense-voice/models/status',
        () => settingsApi.getSenseVoiceModelStatus(),
    );
    const senseVoiceReady = senseVoiceStatus?.ready ?? false;
    const asrReady = senseVoiceReady || (resourceStatus?.transcription?.ready ?? false);
    const hasMediaRecorder = typeof navigator !== 'undefined'
        && Boolean(navigator.mediaDevices?.getUserMedia)
        && typeof MediaRecorder !== 'undefined';

    const [phase, setPhaseState] = useState<WhisperDictationPhase>('idle');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [volume, setVolume] = useState(0);
    const [bands, setBands] = useState<number[]>(EMPTY_BANDS);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [errorText, setErrorText] = useState<string | null>(null);

    const phaseRef = useRef<WhisperDictationPhase>('idle');
    const epochRef = useRef(0);
    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const rafRef = useRef<number | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);

    const setPhase = useCallback((next: WhisperDictationPhase) => {
        phaseRef.current = next;
        setPhaseState(next);
    }, []);

    const isListening = phase === 'listening';
    const isTranscribing = phase === 'transcribing';
    const isRequesting = phase === 'requesting';
    const isBusy = phase !== 'idle';

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
        setIsSpeaking(false);
        setVolume(0);
        setBands(EMPTY_BANDS);
    }, []);

    useEffect(() => () => {
        epochRef.current += 1;
        phaseRef.current = 'idle';
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        }
        recorderRef.current = null;
        cleanupAudio();
    }, [cleanupAudio]);

    const start = useCallback(() => {
        // 同步 ref 拦截 getUserMedia 权限请求期间的双击并发重入
        if (!hasMediaRecorder || !asrReady || phaseRef.current !== 'idle') {
            return;
        }
        const epoch = ++epochRef.current;
        setPhase('requesting');
        setErrorText(null);
        setInterimTranscript('');

        void (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (epochRef.current !== epoch) {
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
                    const stale = epochRef.current !== epoch;
                    cleanupAudio();
                    recorderRef.current = null;

                    if (stale || recordedChunks.length === 0) {
                        if (!stale) {
                            setPhase('idle');
                        }
                        return;
                    }
                    void (async () => {
                        setPhase('transcribing');
                        setInterimTranscript('正在识别语音…');
                        try {
                            const blob = new Blob(recordedChunks, { type: mimeType || 'audio/webm' });
                            const buffer = typeof blob.arrayBuffer === 'function'
                                ? await blob.arrayBuffer()
                                : await new Promise<ArrayBuffer>((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onload = () => resolve(reader.result as ArrayBuffer);
                                    reader.onerror = () => reject(reader.error ?? new Error('Failed to read audio blob'));
                                    reader.readAsArrayBuffer(blob);
                                });
                            const bytes = new Uint8Array(buffer);
                            if (epochRef.current !== epoch) {
                                return;
                            }
                            const { text } = await chatApi.transcribeAudio({ audio: bytes });
                            if (epochRef.current !== epoch) {
                                return;
                            }
                            const clean = text.trim();
                            setInterimTranscript('');
                            if (clean) {
                                onTranscriptReady(clean);
                            }
                        } catch (err) {
                            if (epochRef.current !== epoch) {
                                return;
                            }
                            const rawMsg = err instanceof Error ? err.message : String(err);
                            const cleanMsg = sanitizeDictationError(rawMsg, senseVoiceReady);
                            logger.error('voice dictation transcription failed', { error: cleanMsg });
                            setErrorText(cleanMsg);
                            setInterimTranscript('');
                            // 注意：chat/transcribe-audio 走 IPC registerRoute，异常已由主进程 RendererEvents.error
                            // 触发统一全局错误提示；这里不再重复调用 onError，避免同一失败叠出两个错误框。
                        } finally {
                            if (epochRef.current === epoch) {
                                setPhase('idle');
                            }
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
                        if (!streamRef.current || epochRef.current !== epoch) return;
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
                setPhase('listening');
            } catch (err) {
                if (epochRef.current !== epoch) {
                    return;
                }
                const msg = err instanceof Error ? err.message : String(err);
                logger.error('microphone start failed', { error: msg });
                setErrorText(msg);
                onError?.(msg);
                cleanupAudio();
                setPhase('idle');
            }
        })();
    }, [asrReady, cleanupAudio, hasMediaRecorder, onError, onTranscriptReady, senseVoiceReady, setPhase]);

    const stop = useCallback(() => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        } else if (phaseRef.current === 'requesting') {
            epochRef.current += 1;
            cleanupAudio();
            setPhase('idle');
        } else {
            cleanupAudio();
        }
    }, [cleanupAudio, setPhase]);

    const abort = useCallback(() => {
        epochRef.current += 1;
        setInterimTranscript('');
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        }
        recorderRef.current = null;
        cleanupAudio();
        setPhase('idle');
    }, [cleanupAudio, setPhase]);

    const toggle = useCallback(() => {
        if (phaseRef.current === 'listening') {
            stop();
        } else if (phaseRef.current === 'idle') {
            start();
        }
    }, [start, stop]);

    return {
        isSupported: hasMediaRecorder && asrReady,
        phase,
        isListening,
        isRequesting,
        isTranscribing,
        isBusy,
        isSpeaking,
        volume,
        bands,
        rawBands: bands,
        interimTranscript,
        start,
        stop,
        abort,
        toggle,
        errorText,
    };
}
