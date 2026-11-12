import { useCallback, useEffect, useRef, useState } from 'react';
import { showNotification } from '@/fronted/components/shared/toasts/notification';
import { useTranslation } from 'react-i18next';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { describeAsrFailure } from '@/common/utils/practice/asr-error';
import { practiceApi } from './practiceApi';
import usePracticePanel from './practiceStore';
import {
    nextRecorderPhase,
    type PracticeRecorderEvent,
    type PracticeRecorderPhase,
} from './lib/recorder-phase';

const logger = getRendererLogger('usePracticeRecorder');

export type { PracticeRecorderPhase };

/** 录音结束回传的额外本地声学摘要（与音频字节同步交由上层即时渲染波形与 A/B 回放）。 */
export interface RecordedAudioArtifact {
    blob: Blob;
    mimeType: string;
    durationMs: number;
}

const VAD_SPEECH_RMS = 0.032;
const VAD_SILENCE_RMS = 0.02;
const VAD_SPEECH_MIN_MS = 180;
const VAD_TRAILING_SILENCE_MS = 1200;
/** VAD 模式下的单段录音上限；UI 秒数展示也以此为准，两处必须共用同一常量。 */
export const VAD_MAX_RECORDING_MS = 20000;

function pickMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined') {
        return undefined;
    }
    for (const mimeType of ['audio/webm;codecs=opus', 'audio/webm']) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }
    return undefined;
}

function resolveAudioContext(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
    };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
}

interface UsePracticeRecorderOptions {
    /** 录音完成后回调(携带 webm/opus 字节与本地 Blob);评分失败在此抛出,由本 hook 统一提示。 */
    onRecordingComplete: (audio: Uint8Array, artifact?: RecordedAudioArtifact) => Promise<void>;
    /**
     * 录音 UI 是否仍处于「可用」状态；默认 true。
     *
     * 面板切到听写页签、隐藏或当前句消失时传 false。此时若正在录音，hook 会主动丢弃当前录音，
     * 避免麦克风继续采集、`practiceStore.recording` 卡在 true 把播放快捷键永久禁用。
     */
    active?: boolean;
    /** 是否启用静音自动结束收麦（VAD）：检测到说话开口后若连续 1.2s 静音自动调用 stop。 */
    vadAutoStop?: boolean;
    /** 实时麦克风归一化音量回调（0..1），用于绘制声纹跳动；避免触发整面板重渲染。 */
    onLevelChange?: (level: number) => void;
}

/**
 * 跟读录音交互:支持手动启停、长按对讲与可选 VAD 静音自动停录。
 *
 * 麦克风约束:显式关闭回声消除/降噪/自动增益,保持原始声纹输入；
 * 若运行环境支持 Web Audio，会附带实时音量采集用于绘制波形。
 *
 * 阶段占用模型：`phaseRef` 是唯一真相，`applyEvent` 在同一个宏任务内同步推进它，
 * React state 只是渲染镜像。所有守卫读 `phaseRef` 而不是渲染闭包——
 * 这是 `requesting` 相存在的意义：`START` 在任何 `await` 之前就被消费，
 * 快速二次触发（双击 / autoFlow 定时器叠加旧闭包）会被转移表挡在副作用之前，
 * 不会再并行打开两条 MediaStream 互相覆盖。
 */
export function usePracticeRecorder({
    onRecordingComplete,
    active = true,
    vadAutoStop = false,
    onLevelChange,
}: UsePracticeRecorderOptions) {
    const { t } = useTranslation('practice');
    const [phase, setPhase] = useState<PracticeRecorderPhase>('idle');
    const phaseRef = useRef<PracticeRecorderPhase>('idle');

    const applyEvent = useCallback((event: PracticeRecorderEvent): boolean => {
        const next = nextRecorderPhase(phaseRef.current, event);
        if (next === null) {
            return false;
        }
        phaseRef.current = next;
        setPhase(next);
        return true;
    }, []);

    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef<number>(0);
    const analyserCtxRef = useRef<AudioContext | null>(null);
    const monitorRafRef = useRef<number | null>(null);
    const mountedRef = useRef<boolean>(true);

    const onDoneRef = useRef(onRecordingComplete);
    const vadRef = useRef(vadAutoStop);
    const onLevelRef = useRef(onLevelChange);

    useEffect(() => {
        onDoneRef.current = onRecordingComplete;
        vadRef.current = vadAutoStop;
        onLevelRef.current = onLevelChange;
    }, [onRecordingComplete, vadAutoStop, onLevelChange]);

    const stopMonitor = useCallback((): void => {
        if (monitorRafRef.current !== null) {
            cancelAnimationFrame(monitorRafRef.current);
            monitorRafRef.current = null;
        }
        const ctx = analyserCtxRef.current;
        analyserCtxRef.current = null;
        if (ctx && ctx.state !== 'closed') {
            void ctx.close().catch(() => undefined);
        }
        onLevelRef.current?.(0);
    }, []);

    const releaseStream = useCallback((): void => {
        stopMonitor();
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
    }, [stopMonitor]);

    const setRecorderPhase = usePracticePanel((s) => s.setRecorderPhase);
    useEffect(() => {
        setRecorderPhase(phase);
    }, [phase, setRecorderPhase]);

    const finishFlow = useCallback((): void => {
        releaseStream();
        mediaRecorderRef.current = null;
        chunksRef.current = [];
    }, [releaseStream]);

    const cancel = useCallback((): void => {
        if (nextRecorderPhase(phaseRef.current, 'CANCEL') === null) {
            return;
        }
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state === 'recording') {
            recorder.onstop = null;
            try {
                recorder.stop();
            } catch {
                // 流已失效时 stop 可能抛 InvalidStateError,丢弃路径无需处理
            }
        }
        finishFlow();
        applyEvent('CANCEL');
    }, [applyEvent, finishFlow]);

    const cancelRef = useRef(cancel);
    useEffect(() => {
        cancelRef.current = cancel;
    }, [cancel]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            const recorder = mediaRecorderRef.current;
            if (recorder && recorder.state === 'recording') {
                recorder.onstop = null;
                try {
                    recorder.stop();
                } catch {
                    // 卸载兜底路径忽略停止异常
                }
            }
            finishFlow();
            phaseRef.current = 'idle';
            setRecorderPhase('idle');
        };
    }, [finishFlow, setRecorderPhase]);

    useEffect(() => {
        if (active) {
            return;
        }
        queueMicrotask(() => cancelRef.current());
    }, [active]);

    const handleRecordingDone = async (): Promise<void> => {
        const recorder = mediaRecorderRef.current;
        const mimeType = recorder?.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationMs = startedAtRef.current > 0 ? Math.max(0, Date.now() - startedAtRef.current) : 0;
        finishFlow();
        if (blob.size === 0) {
            showNotification({ message: t('recorder.empty'), variant: 'error' });
            applyEvent('EMPTY');
            return;
        }
        applyEvent('STOP');
        try {
            const buffer = await blob.arrayBuffer();
            await onDoneRef.current(new Uint8Array(buffer), { blob, mimeType, durationMs });
        } catch (error) {
            logger.error('跟读评分失败', { error });
            // 直接透传会让 parakeet 的整段 C++ stderr 铺满屏幕；这里只给可操作提示。
            const message = describeAsrFailure(error);
            showNotification({
                message,
                variant: 'error',
                // 与 IPC 边界的全局广播共用同一个键：两条通道都报同一件事时合并成一条。
                dedupeKey: `ipc-error:${message}`,
            });
        } finally {
            if (mountedRef.current) {
                applyEvent('SCORED');
            }
        }
    };

    const startAudioMonitor = (stream: MediaStream, recorder: MediaRecorder): void => {
        const Ctx = resolveAudioContext();
        if (!Ctx) return;
        try {
            const ctx = new Ctx();
            analyserCtxRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            const data = new Float32Array(analyser.fftSize);

            let speechActiveMs = 0;
            let hasSpoken = false;
            let silenceSince = 0;
            let lastFrameTs = performance.now();

            const tick = () => {
                if (recorder.state !== 'recording') return;
                analyser.getFloatTimeDomainData(data);
                let sumSq = 0;
                for (let i = 0; i < data.length; i += 1) {
                    sumSq += data[i] * data[i];
                }
                const rms = Math.sqrt(sumSq / data.length);
                onLevelRef.current?.(Math.min(1, rms * 6));

                const now = performance.now();
                const dt = Math.min(200, Math.max(0, now - lastFrameTs));
                lastFrameTs = now;

                if (vadRef.current) {
                    if (rms >= VAD_SPEECH_RMS) {
                        speechActiveMs += dt;
                        silenceSince = 0;
                        if (speechActiveMs >= VAD_SPEECH_MIN_MS) {
                            hasSpoken = true;
                        }
                    } else if (hasSpoken && rms < VAD_SILENCE_RMS) {
                        if (silenceSince === 0) {
                            silenceSince = now;
                        } else if (now - silenceSince >= VAD_TRAILING_SILENCE_MS) {
                            recorder.stop();
                            return;
                        }
                    }
                    if (startedAtRef.current > 0 && Date.now() - startedAtRef.current >= VAD_MAX_RECORDING_MS) {
                        recorder.stop();
                        return;
                    }
                }

                monitorRafRef.current = requestAnimationFrame(tick);
            };
            monitorRafRef.current = requestAnimationFrame(tick);
        } catch {
            // 某些无音频硬件/测试替身流不允许接入 AnalyserNode,忽略波形监控不影响录音
        }
    };

    const isRequestingActive = (): boolean => mountedRef.current && phaseRef.current === 'requesting';

    const start = async (): Promise<void> => {
        if (phaseRef.current !== 'idle') return;
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            showNotification({ message: t('recorder.unsupported'), variant: 'error' });
            return;
        }
        // 同步占位：requesting 相让后续任何 await 期间的二次触发（双击 / autoFlow 旧闭包）
        // 在转移表处被拒绝，副作用根本不会发生。
        applyEvent('START');
        try {
            const micStatus = await practiceApi.ensureMicrophone();
            if (!isRequestingActive()) {
                return;
            }
            if (micStatus !== 'granted') {
                logger.warn('麦克风授权未就绪，取消跟读录音', { micStatus });
                showNotification({ message: t('recorder.denied'), variant: 'error' });
                applyEvent('CANCEL');
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });
            if (!isRequestingActive()) {
                // 授权弹窗尚未落定时若已取消或卸载，立即释放刚拿到的硬件音轨，禁止后台开启 MediaRecorder。
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            mediaStreamRef.current = stream;
        } catch (error) {
            logger.error('获取麦克风失败', { error });
            if (!isRequestingActive()) {
                return;
            }
            showNotification({ message: t('recorder.denied'), variant: 'error' });
            releaseStream();
            applyEvent('CANCEL');
            return;
        }

        const stream = mediaStreamRef.current;
        if (!stream) {
            return;
        }

        playerActions.pause();
        chunksRef.current = [];
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;
        startedAtRef.current = Date.now();
        recorder.ondataavailable = (event: BlobEvent) => {
            if (event.data.size > 0) {
                chunksRef.current.push(event.data);
            }
        };
        recorder.onstop = () => {
            releaseStream();
            void handleRecordingDone();
        };
        recorder.start();
        startAudioMonitor(stream, recorder);
        applyEvent('MIC_READY');
    };

    const stop = (): void => {
        if (phaseRef.current !== 'recording') return;
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;
        try {
            // VAD 自动停录到 onstop 回调推进阶段之间存在一帧窗口，
            // 此时 recorder 已 inactive；Chromium 对 inactive 调 stop() 会抛 InvalidStateError。
            if (recorder.state === 'recording') {
                recorder.stop();
            }
        } catch (error) {
            logger.warn('停止跟读录音时 recorder 已失效', { error });
        }
    };

    return { phase, start, stop, cancel };
}
