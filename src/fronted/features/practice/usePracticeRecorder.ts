import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { practiceApi } from './practiceApi';
import usePracticePanel from './practiceStore';
import {
    nextRecorderPhase,
    type PracticeRecorderEvent,
    type PracticeRecorderPhase,
} from './lib/recorder-phase';

const logger = getRendererLogger('usePracticeRecorder');

export type { PracticeRecorderPhase };

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
    /**
     * 录音 UI 是否仍处于「可用」状态；默认 true。
     *
     * 面板切到听写页签、隐藏或当前句消失时传 false。此时若正在录音，hook 会主动丢弃当前录音，
     * 避免麦克风继续采集、`practiceStore.recording` 卡在 true 把播放快捷键永久禁用。
     * 用声明式开关而不是让每个调用点自己记得调 cancel，是因为「忘记调」的代价是全局状态泄漏。
     */
    active?: boolean;
}

/**
 * 跟读录音交互:点击开始、再次点击结束并提交评分。
 * 麦克风约束:显式关闭回声消除/降噪/自动增益,要麦克风原始输入;
 * 录音字节直接交给调用方评分。
 */
export function usePracticeRecorder({ onRecordingComplete, active = true }: UsePracticeRecorderOptions) {
    const { t } = useTranslation('practice');
    const [phase, setPhase] = useState<PracticeRecorderPhase>('idle');
    /**
     * 按转移表推进阶段。
     *
     * 所有 `setPhase` 都走这里，非法事件（例如评分中收到 `CANCEL`）会被静默忽略，
     * 而不是像以前那样靠每个调用点自己判 `phase !== 'recording'`。规则本身在
     * `lib/recorder-phase.ts`，有独立单测覆盖。
     */
    const dispatch = useCallback((event: PracticeRecorderEvent): void => {
        setPhase((current) => nextRecorderPhase(current, event) ?? current);
    }, []);
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

    /** 收尾:释放麦克风、清空缓冲,回到空闲(processing 阶段除外)。 */
    const finishFlow = useCallback((): void => {
        releaseStream();
        mediaRecorderRef.current = null;
        chunksRef.current = [];
    }, [releaseStream]);

    /**
     * 停掉采集并丢弃当前录音，不触发评分回调。
     *
     * 用于「用户离开了跟读流程，但并没有想提交这段录音」的场景：关闭面板、切到听写页签。
     * 与 `stop()` 的区别是它不调用 `onRecordingComplete`，因此不会把半截录音送去评分。
     *
     * 只在 `recording` 阶段生效：`processing` 阶段的音频已经交给评分链路，
     * 这里若把 phase 打回 `idle`，用户能立刻再开一段录音与仍在进行的评分并发，
     * 结果会挂到错误的句子上。评分完成后由 `handleRecordingDone` 自己收尾。
     *
     * @returns 无返回值。
     */
    const cancel = useCallback((): void => {
        // 只有 `recording` 阶段能真正丢弃；`processing` 阶段的音频已交给评分链路，
        // 这里若把 phase 打回 idle，用户能立刻再开一段录音与仍在进行的评分并发。
        // 判据在转移表里（`processing + CANCEL` 返回 null），不在这里重复一遍。
        if (nextRecorderPhase(phase, 'CANCEL') === null) {
            return;
        }
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state === 'recording') {
            recorder.onstop = null; // 丢弃路径不走收尾,避免空 blob 误报 toast
            try {
                recorder.stop();
            } catch {
                // 流已失效时 stop 可能抛 InvalidStateError,丢弃路径无需处理
            }
        }
        finishFlow();
        dispatch('CANCEL');
    }, [dispatch, finishFlow, phase]);

    /**
     * 丢弃录音的稳定引用。
     *
     * 供 effect 在「录音 UI 退场」时调用：effect 依赖这个 ref 而不是 cancel 本体，
     * 避免 cancel 每次重建都重新触发 effect。
     */
    const cancelRef = useRef(cancel);
    useEffect(() => {
        cancelRef.current = cancel;
    }, [cancel]);

    // 卸载兜底:面板被条件卸载时不会有人再点停止,主动断开收尾回调并停轨,
    // 否则麦克风保持占用、缓冲持续累积,重开面板还会与新一轮录音并发采集。
    // 组件卸载后不会再有 phase 变化去同步 practiceStore.recording,必须在这里显式归位,
    // 否则该标志永久为 true,播放类快捷键会被一直禁用。
    useEffect(() => () => {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state === 'recording') {
            recorder.onstop = null;
            try {
                recorder.stop();
            } catch {
                // 流已失效时 stop 可能抛 InvalidStateError,卸载路径无需处理
            }
        }
        releaseStream();
        setRecording(false);
    }, [releaseStream, setRecording]);

    /**
     * 录音 UI 退场（切听写页签 / 面板隐藏 / 当前句消失）时丢弃当前录音。
     *
     * 与卸载不同，此时组件仍然挂载，卸载兜底不会触发。若不在这里收尾，麦克风会继续采集，
     * 且 `practiceStore.recording` 会一直为 true，把播放类快捷键永久禁用。
     *
     * 收尾动作放进 `queueMicrotask`：effect 体内同步 setState 会触发 React 的级联渲染告警，
     * 而这里只需要「本轮渲染结束后立刻执行」，语义上等价。
     */
    useEffect(() => {
        if (active) {
            return;
        }
        queueMicrotask(() => cancelRef.current());
    }, [active]);

    const handleRecordingDone = async (): Promise<void> => {
        const recorder = mediaRecorderRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder?.mimeType || 'audio/webm' });
        finishFlow();
        if (blob.size === 0) {
            toast.error(t('recorder.empty'));
            // 复位到空闲,否则面板停留在录音态:停止键引用已空、开始键被 phase 守卫拒绝,面板内无出路
            dispatch('EMPTY');
            return;
        }
        dispatch('STOP');
        try {
            const buffer = await blob.arrayBuffer();
            await onDoneRef.current(new Uint8Array(buffer));
        } catch (error) {
            logger.error('跟读评分失败', { error });
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            dispatch('SCORED');
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
        dispatch('START');
    };

    const stop = (): void => {
        if (phase !== 'recording') return;
        mediaRecorderRef.current?.stop();
    };

    return { phase, start, stop, cancel };
}
