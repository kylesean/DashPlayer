import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { practiceApi } from './practiceApi';
import usePracticePanel from './practiceStore';

const logger = getRendererLogger('usePracticeRecorder');

export type PracticeRecorderPhase = 'idle' | 'recording' | 'processing';

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

interface UsePracticeRecorderOptions {
    /** 录音完成后回调(携带 webm/opus 字节);评分失败在此抛出,由本 hook 统一提示。 */
    onRecordingComplete: (audio: Uint8Array) => Promise<void>;
}

/**
 * 跟读录音交互:点击开始、再次点击结束并提交评分。
 * 麦克风约束:显式关闭回声消除/降噪/自动增益,要麦克风原始输入;
 * 录音字节直接交给调用方评分。
 */
export function usePracticeRecorder({ onRecordingComplete }: UsePracticeRecorderOptions) {
    const { t } = useTranslation('practice');
    const [phase, setPhase] = useState<PracticeRecorderPhase>('idle');
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const onDoneRef = useRef(onRecordingComplete);
    // 订阅回调闭包固定于注册时刻,经 ref 读取最新回调;赋值放 effect 避免渲染期写 ref
    useEffect(() => {
        onDoneRef.current = onRecordingComplete;
    }, [onRecordingComplete]);

    const releaseStream = useCallback((): void => {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
    }, []);

    // 录音状态提升到 practiceStore:快捷键层据此在录音中停用播放类快捷键,
    // 避免录音中被开播/切句导致评分挂到错误的意群上
    const setRecording = usePracticePanel((s) => s.setRecording);
    useEffect(() => {
        setRecording(phase === 'recording');
    }, [phase, setRecording]);

    // 卸载兜底:面板被条件卸载时不会有人再点停止,主动断开收尾回调并停轨,
    // 否则麦克风保持占用、缓冲持续累积,重开面板还会与新一轮录音并发采集
    useEffect(() => () => {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state === 'recording') {
            recorder.onstop = null; // 卸载路径不走收尾,避免空 blob 误报 toast
            try {
                recorder.stop();
            } catch {
                // 流已失效时 stop 可能抛 InvalidStateError,卸载路径无需处理
            }
        }
        releaseStream();
    }, [releaseStream]);

    /** 收尾:释放麦克风、清空缓冲,回到空闲(processing 阶段除外)。 */
    const finishFlow = (): void => {
        releaseStream();
        mediaRecorderRef.current = null;
        chunksRef.current = [];
    };

    const handleRecordingDone = async (): Promise<void> => {
        const recorder = mediaRecorderRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder?.mimeType || 'audio/webm' });
        finishFlow();
        if (blob.size === 0) {
            toast.error(t('recorder.empty'));
            // 复位到空闲,否则面板停留在录音态:停止键引用已空、开始键被 phase 守卫拒绝,面板内无出路
            setPhase('idle');
            return;
        }
        setPhase('processing');
        try {
            const buffer = await blob.arrayBuffer();
            await onDoneRef.current(new Uint8Array(buffer));
        } catch (error) {
            logger.error('跟读评分失败', { error });
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setPhase('idle');
        }
    };

    const start = async (): Promise<void> => {
        if (phase !== 'idle') return;
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            toast.error(t('recorder.unsupported'));
            return;
        }
        try {
            // macOS 的授权框要由主进程请求才会弹;Linux/Windows 恒 granted
            const micStatus = await practiceApi.ensureMicrophone();
            if (micStatus !== 'granted') {
                logger.warn('麦克风授权未就绪，取消跟读录音', { micStatus });
                toast.error(t('recorder.denied'));
                return;
            }
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });
        } catch (error) {
            logger.error('获取麦克风失败', { error });
            toast.error(t('recorder.denied'));
            releaseStream();
            return;
        }

        // 录音期间暂停播放,避免原句声音混进麦克风
        playerActions.pause();
        chunksRef.current = [];
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(mediaStreamRef.current, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;
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
        setPhase('recording');
    };

    const stop = (): void => {
        if (phase !== 'recording') return;
        mediaRecorderRef.current?.stop();
    };

    return { phase, start, stop };
}
