import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowRightLeft,
    Loader2,
    Mic,
    Minus,
    Pause,
    Play,
    Plus,
    Radio,
    RotateCcw,
    SkipForward,
    Square,
    Volume2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Button } from '@astryxdesign/core/Button';
import { Switch } from '@astryxdesign/core/Switch';
import type { SentencePracticeResultVO } from '@/common/contracts/sentence-practice';
import type { RhythmTrendVO } from '@/common/learning/rhythmTrend';
import UrlUtil from '@/common/utils/UrlUtil';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import { usePlayer } from '@/frontend/features/player/playerStore';
import { usePlayerState } from '@/frontend/features/player/playerState';
import { useTrainingModeStore } from '@/frontend/features/player/trainingStore';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import { cn } from '@/frontend/lib/utils';
import { isInteractiveTarget, isTextEntryTarget } from '@/frontend/lib/keyboard';
import { createBoostedAudio, useAudioVolume } from '@/frontend/infrastructure/audio/audioVolume';
import { decodeRecordedAudioSummary, playMicReadyCue, playSentencePassCue } from '../audioFeedback';
import type { PracticeUnit } from '../practiceUnit';
import usePracticePanel, { type ShadowingStyle } from '../practiceStore';
import { resolveVadLimits, usePracticeRecorder, type RecordedAudioArtifact } from '../usePracticeRecorder';
import PracticeDiffSentence from './PracticeDiffSentence';

const logger = getRendererLogger('ShadowingStudio');

const LIVE_WAVE_BAR_COUNT = 28;
const STATIC_WAVE_BIN_COUNT = 40;
const PUSH_TO_TALK_HOLD_MS = 280;

interface ShadowingStudioProps {
    unit: PracticeUnit;
    style: ShadowingStyle;
    asrReady: boolean;
    translationText: string;
    result: SentencePracticeResultVO | null;
    /** 跨次节奏趋势；样本不足或拉取失败时为 null/undefined。 */
    trend?: RhythmTrendVO | null;
    onScoreRecording: (audio: Uint8Array) => Promise<SentencePracticeResultVO | null>;
    onReplay: () => void;
    onSlowReplay: () => void;
    onNextSentence: () => void;
    onHasRecordingChange?: (hasRecording: boolean) => void;
}

interface LocalRecordingSnapshot {
    audioUrl: string;
    bins: number[];
    durationMs: number;
}

type AbContrastPhase = 'idle' | 'playing-original' | 'gap' | 'playing-mine';

/** 节拍跟读倒计时进度条：按 rAF 流畅刷新剩余留白时间。 */
function BeatPauseMeter({
    untilTs,
    durationMs,
    onSkip,
}: {
    untilTs: number;
    durationMs: number;
    onSkip: () => void;
}) {
    const { t } = useTranslation('practice');
    const [remainingMs, setRemainingMs] = useState(() => Math.max(0, untilTs - Date.now()));

    useEffect(() => {
        let rafId = 0;
        const tick = () => {
            const left = Math.max(0, untilTs - Date.now());
            setRemainingMs(left);
            if (left > 0) {
                rafId = requestAnimationFrame(tick);
            }
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [untilTs]);

    const ratio = durationMs > 0 ? Math.max(0, Math.min(1, 1 - remainingMs / durationMs)) : 1;

    return (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/8 px-3 py-2">
            <div className="flex-1 flex flex-col gap-1 min-w-0">
                <div className="flex items-center justify-between text-sm font-medium text-success-text">
                    <span>{t('shadowing.beatWaiting', { defaultValue: '请开口跟读 · 停顿倒计时' })}</span>
                    <span className="tabular-nums font-mono">{(remainingMs / 1000).toFixed(1)}s</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-success/20">
                    <div
                        className="h-full rounded-full bg-success transition-[width] duration-75"
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                </div>
            </div>
            <Button
                variant="ghost"
                size="sm"
                icon={<SkipForward className="h-3.5 w-3.5" />}
                label={t('shadowing.beatSkip', { defaultValue: '跳过' })}
                onClick={onSkip}
            />
        </div>
    );
}

/**
 * 节拍留白跟读视图（原训练菜单中的「影子跟读」合流于此）。
 * 无需下载语音识别模型，按句末留白倍率留出跟读停顿后顺畅过渡下一句。
 */
function BeatShadowingView({
    unit,
    translationText,
}: {
    unit: PracticeUnit;
    translationText: string;
}) {
    const { t } = useTranslation('practice');
    const playing = usePlayerState((s) => s.playing);
    const shadowingPause = usePlayer((s) => s.shadowingPause);
    const shadowingRatio = useTrainingModeStore((s) => s.config.shadowingRatio);
    const updateConfig = useTrainingModeStore((s) => s.updateConfig);

    useEffect(() => {
        playerActions.setShadowing?.(true);
        return () => {
            playerActions.setShadowing?.(false);
        };
    }, []);

    const adjustRatio = (delta: number): void => {
        const next = Math.round(Math.max(0.5, Math.min(3.0, shadowingRatio + delta)) * 10) / 10;
        updateConfig({ shadowingRatio: next });
    };

    const isBeatActive = playing || shadowingPause !== null;

    return (
        <div className="flex flex-col gap-3">
            <PracticeDiffSentence unit={unit} />
            {translationText ? (
                <p className="text-sm text-secondary leading-relaxed">{translationText}</p>
            ) : null}

            {shadowingPause && (
                <BeatPauseMeter
                    key={shadowingPause.untilTs}
                    untilTs={shadowingPause.untilTs}
                    durationMs={shadowingPause.durationMs}
                    onSkip={() => playerActions.nextSentence?.()}
                />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex items-center gap-2">
                    <Button
                        variant="primary"
                        size="sm"
                        icon={isBeatActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        label={isBeatActive
                            ? t('panel.stop')
                            : t('shadowing.beatStart', { defaultValue: '开始节拍连读' })}
                        onClick={() => {
                            if (isBeatActive) {
                                playerActions.pause();
                            } else {
                                playerActions.gotoSentence(unit.anchor);
                                playerActions.play();
                            }
                        }}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        label={t('panel.replay')}
                        onClick={() => {
                            playerActions.gotoSentence(unit.anchor);
                            playerActions.play();
                        }}
                    />
                </div>

                {/* 句末停顿倍率行内微调 */}
                <div
                    title={t('shadowing.beatRatioTooltip', {
                        defaultValue: '每句播完自动暂停 [原句时长 × {{ratio}}] 留给你跟读（例：4秒原句停 {{ex}}秒）',
                        ratio: shadowingRatio.toFixed(1),
                        ex: (4 * shadowingRatio).toFixed(1),
                    })}
                    className="inline-flex h-[var(--size-element-sm)] items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-1.5 text-[length:var(--text-supporting-size)] text-secondary"
                >
                    <button
                        type="button"
                        aria-label={t('shadowing.ratioDecrease', { defaultValue: '缩短停顿倍率' })}
                        onClick={() => adjustRatio(-0.2)}
                        className="rounded p-1 hover:bg-muted hover:text-primary transition-colors cursor-pointer"
                    >
                        <Minus className="h-3 w-3" />
                    </button>
                    <span className="px-1 font-mono tabular-nums text-primary">
                        {t('shadowing.beatRatioLabel', { defaultValue: '句末停顿 {{ratio}}×', ratio: shadowingRatio.toFixed(1) })}
                    </span>
                    <button
                        type="button"
                        aria-label={t('shadowing.ratioIncrease', { defaultValue: '延长停顿倍率' })}
                        onClick={() => adjustRatio(0.2)}
                        className="rounded p-1 hover:bg-muted hover:text-primary transition-colors cursor-pointer"
                    >
                        <Plus className="h-3 w-3" />
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * 录音对比跟读视图：
 * - 长按 Space 对讲或自动流水线（播完滴声开麦 + VAD 静音停麦）；
 * - 实时动态音量条 + 离线 40 柱波形包络 + 原声/自录语速比；
 * - 一键 V 键 A/B 顺序连播对比；
 * - 未下载本地 ASR 模型时保留完整录音、声纹与 A/B 对比，仅弱提示识别未开启。
 */
function RecordShadowingView({
    unit,
    asrReady,
    translationText,
    result,
    trend,
    onScoreRecording,
    onReplay,
    onSlowReplay,
    onNextSentence,
    onHasRecordingChange,
}: Omit<ShadowingStudioProps, 'style'>) {
    const { t } = useTranslation('practice');
    const autoRecordFlow = usePracticePanel((s) => s.autoRecordFlow);
    const setAutoRecordFlow = usePracticePanel((s) => s.setAutoRecordFlow);

    const [localRecording, setLocalRecording] = useState<LocalRecordingSnapshot | null>(null);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [abPhase, setAbPhase] = useState<AbContrastPhase>('idle');
    const [minePlayProgress, setMinePlayProgress] = useState<number | null>(null);

    const liveBarRefs = useRef<Array<HTMLSpanElement | null>>([]);
    const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
    const playbackDisposeRef = useRef<(() => void) | null>(null);
    const minePlayRafRef = useRef<number | null>(null);
    const abRunIdRef = useRef(0);
    const clipOwnedRef = useRef(false);
    const mountedRef = useRef(true);
    const abTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const localUrlRef = useRef<string | null>(null);
    const pttDownAtRef = useRef<number | null>(null);

    const stopContrastAudio = useCallback(() => {
        abRunIdRef.current += 1;
        if (abTimerRef.current !== null) {
            clearTimeout(abTimerRef.current);
            abTimerRef.current = null;
        }
        // autoFlow 的「播完自动开麦」定时器也一并撤销：用户手动开录音时，
        // 不能让残留的定时器再开出第二条录音。
        if (autoCueTimerRef.current !== null) {
            clearTimeout(autoCueTimerRef.current);
            autoCueTimerRef.current = null;
        }
        if (clipOwnedRef.current) {
            clipOwnedRef.current = false;
            playerActions.clearPracticeClip?.();
        }
        if (minePlayRafRef.current !== null) {
            cancelAnimationFrame(minePlayRafRef.current);
            minePlayRafRef.current = null;
        }
        playbackAudioRef.current?.pause();
        playbackAudioRef.current = null;
        playbackDisposeRef.current?.();
        playbackDisposeRef.current = null;
        setMinePlayProgress(null);
        setAbPhase('idle');
    }, []);

    // 卸载时回收本地录音 ObjectURL、对比计时器、受控原声与回放音轨（换句靠外层 key={unit.key} 重挂载清理）
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (minePlayRafRef.current !== null) {
                cancelAnimationFrame(minePlayRafRef.current);
                minePlayRafRef.current = null;
            }
            if (autoCueTimerRef.current !== null) {
                clearTimeout(autoCueTimerRef.current);
                autoCueTimerRef.current = null;
            }
            abRunIdRef.current += 1;
            if (abTimerRef.current !== null) {
                clearTimeout(abTimerRef.current);
                abTimerRef.current = null;
            }
            if (clipOwnedRef.current) {
                clipOwnedRef.current = false;
                playerActions.clearPracticeClip?.();
            }
            playbackAudioRef.current?.pause();
            playbackAudioRef.current = null;
            playbackDisposeRef.current?.();
            playbackDisposeRef.current = null;
            if (localUrlRef.current) {
                URL.revokeObjectURL(localUrlRef.current);
                localUrlRef.current = null;
            }
        };
    }, []);

    const handleLevelChange = useCallback((level: number) => {
        const bars = liveBarRefs.current;
        for (let i = 0; i < bars.length; i += 1) {
            const el = bars[i];
            if (!el) continue;
            // 对不同柱分配平滑起伏权重，形成中心偏高的声浪形态
            const distFromMid = Math.abs(i - (LIVE_WAVE_BAR_COUNT - 1) / 2) / (LIVE_WAVE_BAR_COUNT / 2);
            const envelope = 1 - distFromMid * 0.55;
            const jitter = 0.72 + ((i * 37) % 10) * 0.04;
            const scale = Math.max(0.14, Math.min(1, level * envelope * jitter));
            el.style.transform = `scaleY(${scale.toFixed(2)})`;
        }
    }, []);

    const handleRecordingComplete = useCallback(async (audio: Uint8Array, artifact?: RecordedAudioArtifact) => {
        if (artifact?.blob) {
            const nextUrl = URL.createObjectURL(artifact.blob);
            if (!mountedRef.current) {
                URL.revokeObjectURL(nextUrl);
                return;
            }
            if (localUrlRef.current) {
                URL.revokeObjectURL(localUrlRef.current);
            }
            localUrlRef.current = nextUrl;
            const summary = await decodeRecordedAudioSummary(artifact.blob, STATIC_WAVE_BIN_COUNT);
            if (!mountedRef.current) {
                return;
            }
            setLocalRecording({
                audioUrl: nextUrl,
                bins: summary.bins,
                durationMs: summary.durationMs > 0 ? summary.durationMs : artifact.durationMs,
            });
        }
        if (asrReady && mountedRef.current) {
            const scoreResult = await onScoreRecording(audio);
            if (mountedRef.current && scoreResult && scoreResult.score >= 80) {
                playSentencePassCue();
            }
        }
    }, [asrReady, onScoreRecording]);

    const expectedDurationMs = Math.max(0, (unit.range.end - unit.range.start) * 1000);
    const { maxRecordingMs } = resolveVadLimits(0, expectedDurationMs);

    const { phase: recorderPhase, start: startRecording, stop: stopRecording, cancel: cancelRecording } = usePracticeRecorder({
        onRecordingComplete: handleRecordingComplete,
        active: true,
        vadAutoStop: autoRecordFlow,
        expectedDurationMs,
        onLevelChange: handleLevelChange,
    });

    useEffect(() => {
        if (recorderPhase !== 'recording') {
            return undefined;
        }
        const timer = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
        return () => window.clearInterval(timer);
    }, [recorderPhase]);

    const playableMineUrl = localRecording?.audioUrl ?? (result?.audioPath ? UrlUtil.toUrl(result.audioPath) : null);

    useEffect(() => {
        onHasRecordingChange?.(Boolean(playableMineUrl));
    }, [onHasRecordingChange, playableMineUrl]);

    const playMineAudioOnly = useCallback((url: string, onEnd?: () => void) => {
        if (minePlayRafRef.current !== null) {
            cancelAnimationFrame(minePlayRafRef.current);
            minePlayRafRef.current = null;
        }
        playbackAudioRef.current?.pause();
        playbackDisposeRef.current?.();
        const { audio, dispose } = createBoostedAudio(url, useAudioVolume.getState().recordingGain);
        playbackAudioRef.current = audio;
        playbackDisposeRef.current = dispose;
        setMinePlayProgress(0);

        const stopProgress = () => {
            if (minePlayRafRef.current !== null) {
                cancelAnimationFrame(minePlayRafRef.current);
                minePlayRafRef.current = null;
            }
            if (playbackDisposeRef.current === dispose) {
                playbackDisposeRef.current = null;
            }
            dispose();
            if (mountedRef.current) {
                setMinePlayProgress(null);
            }
        };

        const tickProgress = () => {
            if (!mountedRef.current || playbackAudioRef.current !== audio || audio.paused || audio.ended) {
                return;
            }
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                setMinePlayProgress(Math.min(1, Math.max(0, audio.currentTime / audio.duration)));
            }
            minePlayRafRef.current = requestAnimationFrame(tickProgress);
        };

        audio.onended = () => {
            stopProgress();
            onEnd?.();
        };
        void audio.play().then(() => {
            if (mountedRef.current && playbackAudioRef.current === audio && !audio.paused) {
                minePlayRafRef.current = requestAnimationFrame(tickProgress);
            }
        }).catch((error) => {
            logger.error('跟读录音回放失败', { error });
            toast.error(t('recorder.playbackFailed'));
            stopProgress();
            onEnd?.();
        });
    }, [t]);

    const triggerABContrast = useCallback(() => {
        if (!playableMineUrl) return;
        if (abPhase !== 'idle') {
            stopContrastAudio();
            playerActions.pause();
            return;
        }
        const runId = ++abRunIdRef.current;
        clipOwnedRef.current = true;
        setAbPhase('playing-original');
        playerActions.playPracticeClip(unit.range, unit.anchor, {
            onEnded: () => {
                clipOwnedRef.current = false;
                if (abRunIdRef.current !== runId || !mountedRef.current) return;
                setAbPhase('gap');
                abTimerRef.current = setTimeout(() => {
                    if (abRunIdRef.current !== runId || !mountedRef.current) return;
                    setAbPhase('playing-mine');
                    playMineAudioOnly(playableMineUrl, () => {
                        if (abRunIdRef.current === runId && mountedRef.current) {
                            setAbPhase('idle');
                        }
                    });
                }, 280);
            },
            onAbort: () => {
                clipOwnedRef.current = false;
                if (abRunIdRef.current === runId && mountedRef.current) {
                    setAbPhase('idle');
                }
            },
        });
    }, [abPhase, playMineAudioOnly, playableMineUrl, stopContrastAudio, unit]);

    const triggerAutoFlow = useCallback(() => {
        stopContrastAudio();
        const runId = ++abRunIdRef.current;
        clipOwnedRef.current = true;
        playerActions.playPracticeClip(unit.range, unit.anchor, {
            onEnded: () => {
                clipOwnedRef.current = false;
                if (abRunIdRef.current !== runId || !mountedRef.current) return;
                playMicReadyCue();
                autoCueTimerRef.current = setTimeout(() => {
                    if (abRunIdRef.current !== runId || !mountedRef.current) return;
                    setRecordingSeconds(0);
                    void startRecording();
                }, 180);
            },
            onAbort: () => {
                clipOwnedRef.current = false;
            },
        });
    }, [startRecording, stopContrastAudio, unit]);

    const recorderBusy = recorderPhase !== 'idle';

    // 键盘交互：R 原音、S 0.75×、Space 对讲/启停、V 键 A/B 对比、P 听我的、Enter 下一句
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (isTextEntryTarget(target) || isInteractiveTarget(target)) {
                return;
            }
            if ((e.key === 'r' || e.key === 'R') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                // 请求权限、录音、评分阶段均禁止试听，防止状态竞态或录进外放原声
                if (recorderBusy) return;
                e.preventDefault();
                onReplay();
                return;
            }
            if ((e.key === 's' || e.key === 'S') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                if (recorderBusy) return;
                e.preventDefault();
                onSlowReplay();
                return;
            }
            if (e.key === ' ') {
                if (e.repeat) return;
                e.preventDefault();
                if (recorderPhase === 'idle') {
                    stopContrastAudio();
                    pttDownAtRef.current = Date.now();
                    setRecordingSeconds(0);
                    playMicReadyCue();
                    void startRecording();
                } else if (recorderPhase === 'recording') {
                    pttDownAtRef.current = null;
                    stopRecording();
                }
                return;
            }
            if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (playableMineUrl && !recorderBusy) {
                    e.preventDefault();
                    triggerABContrast();
                }
                return;
            }
            if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (playableMineUrl && !recorderBusy) {
                    e.preventDefault();
                    stopContrastAudio();
                    playMineAudioOnly(playableMineUrl);
                }
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !recorderBusy) {
                e.preventDefault();
                onNextSentence();
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key !== ' ' || pttDownAtRef.current === null) return;
            const heldMs = Date.now() - pttDownAtRef.current;
            pttDownAtRef.current = null;
            if (heldMs >= PUSH_TO_TALK_HOLD_MS) {
                if (recorderPhase === 'recording') {
                    stopRecording();
                } else if (recorderPhase === 'requesting') {
                    cancelRecording();
                }
            }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [
        cancelRecording,
        onNextSentence,
        onReplay,
        onSlowReplay,
        playMineAudioOnly,
        playableMineUrl,
        recorderBusy,
        recorderPhase,
        startRecording,
        stopContrastAudio,
        stopRecording,
        triggerABContrast,
    ]);

    const originalDurationMs = Math.max(200, Math.round((unit.range.end - unit.range.start) * 1000));
    const speedRatio = localRecording && localRecording.durationMs > 200
        ? originalDurationMs / localRecording.durationMs
        : null;

    return (
        <div
            className="flex flex-col gap-2.5"
            data-recorder-phase={recorderPhase}
            data-ab-phase={abPhase}
        >
            {/* 原句区：有 ASR 识别结果时直接原地差分高亮，平时保留干净原文与划词查词 */}
            <PracticeDiffSentence unit={unit} result={result} />
            {translationText ? (
                <p className="text-sm text-secondary leading-relaxed">{translationText}</p>
            ) : null}

            {/* 声学反馈条：实时收音动效 或 录制完成后的 40 柱声纹包络 + 语速/得分 */}
            {(recorderPhase === 'recording' || localRecording || result) && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/35 px-3 py-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {recorderPhase === 'recording' ? (
                            <>
                                <div className="flex h-6 items-center gap-[2px]" aria-hidden>
                                    {Array.from({ length: LIVE_WAVE_BAR_COUNT }).map((_, idx) => (
                                        <span
                                            key={idx}
                                            ref={(el) => { liveBarRefs.current[idx] = el; }}
                                            className="h-5 w-[2.5px] origin-center rounded-full bg-error transition-transform duration-75"
                                            style={{ transform: 'scaleY(0.16)' }}
                                        />
                                    ))}
                                </div>
                                <span
                                    className={cn(
                                        'text-sm font-mono tabular-nums',
                                        // 临近 VAD 上限时提示录音即将自动结束
                                        recordingSeconds >= Math.floor(maxRecordingMs / 1000) - 3
                                            ? 'text-amber-500'
                                            : 'text-error-text',
                                    )}
                                >
                                    {recordingSeconds}s{autoRecordFlow ? ` · ${t('shadowing.vadListening', { defaultValue: '停顿自动停麦' })}` : ''}
                                </span>
                            </>
                        ) : localRecording ? (
                            <div className="flex items-center gap-[2px] h-6" aria-hidden>
                                {localRecording.bins.map((bin, idx) => {
                                    const isPlayingMine = minePlayProgress !== null;
                                    const playedIdx = isPlayingMine
                                        ? Math.min(
                                            localRecording.bins.length - 1,
                                            Math.floor(minePlayProgress * localRecording.bins.length),
                                        )
                                        : -1;
                                    const isPassed = isPlayingMine && idx <= playedIdx;
                                    const isCurrent = isPlayingMine && idx === playedIdx;
                                    return (
                                        <span
                                            key={idx}
                                            className={cn(
                                                'w-[2.5px] origin-center rounded-full transition-all duration-75',
                                                isPassed
                                                    ? 'bg-accent-bg'
                                                    : isPlayingMine || abPhase === 'playing-mine'
                                                        ? 'bg-accent-bg/35'
                                                        : 'bg-primary/45',
                                            )}
                                            style={{
                                                height: `${Math.round(Math.max(4, bin * 22))}px`,
                                                transform: isCurrent ? 'scaleY(1.28)' : 'scaleY(1)',
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-metadata">
                        {abPhase !== 'idle' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent-bg/15 px-2 py-0.5 font-medium text-accent">
                                <Radio className="h-3 w-3 animate-pulse" />
                                {abPhase === 'playing-original'
                                    ? t('shadowing.abOriginal', { defaultValue: '原声 (A)' })
                                    : abPhase === 'playing-mine'
                                        ? t('shadowing.abMine', { defaultValue: '我的录音 (B)' })
                                        : '…'}
                            </span>
                        )}
                        {speedRatio !== null && (
                            <span className="rounded-full bg-body/80 border border-border/50 px-2 py-0.5 font-mono tabular-nums text-secondary">
                                {t('shadowing.speedCompare', {
                                    defaultValue: '语速 {{ratio}}× ({{mine}}s/{{orig}}s)',
                                    ratio: speedRatio.toFixed(2),
                                    mine: (localRecording!.durationMs / 1000).toFixed(1),
                                    orig: (originalDurationMs / 1000).toFixed(1),
                                })}
                            </span>
                        )}
                        {result && (
                            <span
                                className={cn(
                                    'rounded-full px-2.5 py-0.5 font-semibold tabular-nums',
                                    result.score >= 80
                                        ? 'bg-success/15 text-success-text'
                                        : result.score >= 50
                                            ? 'bg-warning-muted text-warning-text'
                                            : 'bg-error/15 text-error-text',
                                )}
                            >
                                {t('result.scoreBadge', { defaultValue: '得分 {{score}}', score: Math.round(result.score) })}
                            </span>
                        )}
                        {!asrReady && localRecording && !result && (
                            <button
                                type="button"
                                onClick={() => { window.location.hash = '#/settings/resources'; }}
                                className="rounded-full bg-warning-muted px-2.5 py-0.5 text-warning-text hover:underline cursor-pointer"
                            >
                                {t('shadowing.asrOptionalHint', { defaultValue: '未装识别模型(仅声纹对比) · 去安装' })}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {result?.rhythm && (
                <RhythmFeedback
                    feedback={result.rhythm}
                    trend={trend}
                />
            )}

            {result?.prosody && (
                <div
                    data-testid="shadowing-prosody-feedback"
                    className="rounded-lg border border-border/60 bg-surface/60 px-3 py-2 space-y-1.5"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-metadata">
                        <span className="font-medium text-primary">
                            {t('shadowing.prosodyTitle', { defaultValue: '原声 DTW 韵律对比' })}
                        </span>
                        <span className="text-secondary tabular-nums">
                            {t('shadowing.prosodyMetrics', {
                                defaultValue: '贴合 {{prosody}}% · 停顿 {{pause}}% · 重音 {{energy}}%',
                                prosody: result.prosody.prosodyScore,
                                pause: result.prosody.pauseMatchScore,
                                energy: result.prosody.energyCorrelation,
                            })}
                        </span>
                    </div>
                    <div className="grid grid-cols-24 gap-0.5 items-end h-5" aria-hidden="true">
                        {result.prosody.referenceEnvelope.map((refVal, idx) => {
                            const userVal = result.prosody?.userEnvelope[idx] ?? 0;
                            return (
                                <div key={idx} className="flex items-end gap-px h-full">
                                    <span
                                        className="w-1/2 rounded-t-xs bg-secondary/35"
                                        style={{ height: `${Math.max(12, Math.round(refVal * 100))}%` }}
                                    />
                                    <span
                                        className="w-1/2 rounded-t-xs bg-accent-bg/85"
                                        style={{ height: `${Math.max(12, Math.round(userVal * 100))}%` }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {result && (() => {
                const weakWords = result.words.filter(
                    (w) => w.phonemes && w.phonemes.some((p) => p.status !== 'ok'),
                );
                if (weakWords.length === 0) return null;
                return (
                    <div
                        data-testid="shadowing-phoneme-feedback"
                        className="rounded-lg border border-border/60 bg-surface/60 px-3 py-2 space-y-1"
                    >
                        <div className="text-metadata font-medium text-primary">
                            {t('shadowing.phonemeIssuesTitle', { defaultValue: '音素定位建议' })}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {weakWords.slice(0, 6).map((w, idx) => {
                                const issues = (w.phonemes ?? []).filter((p) => p.status !== 'ok');
                                return (
                                    <span
                                        key={`${w.expected}-${idx}`}
                                        className="inline-flex items-center gap-1 rounded-md bg-warning-muted/70 px-2 py-0.5 text-metadata text-warning-text"
                                    >
                                        <span className="font-medium">{w.expected}</span>
                                        <span className="font-mono">
                                            {issues.map((p) => (p.heardIpa && p.heardIpa !== p.ipa ? `/${p.ipa}/→/${p.heardIpa}/` : `/${p.ipa}/`)).join(' ')}
                                        </span>
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {result && result.phonemeGopAvailable === false && (
                <p className="text-metadata text-secondary flex items-center justify-between gap-2">
                    <span>{t('shadowing.phonemeGopMissingNote', { defaultValue: '当前为词级评分；下载音素模型可开启音素级纠错' })}</span>
                    <button
                        type="button"
                        onClick={() => { window.location.hash = '#/settings/resources'; }}
                        className="text-accent hover:underline shrink-0 cursor-pointer"
                    >
                        {t('shadowing.installAsrAction', { defaultValue: '下载模型 →' })}
                    </button>
                </p>
            )}

            {!asrReady && !localRecording && recorderPhase === 'idle' && (
                <p className="text-metadata text-secondary flex items-center justify-between gap-2">
                    <span>{t('shadowing.asrDegradedNote', { defaultValue: '未安装语音识别模型：仍可直接录音并对比原音声纹' })}</span>
                    <button
                        type="button"
                        onClick={() => { window.location.hash = '#/settings/resources'; }}
                        className="text-accent hover:underline shrink-0 cursor-pointer"
                    >
                        {t('shadowing.installAsrAction', { defaultValue: '下载模型 →' })}
                    </button>
                </p>
            )}

            {/* 主控制排 */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant={recorderPhase === 'recording' ? 'primary' : 'secondary'}
                        size="sm"
                        isDisabled={recorderPhase === 'processing' || recorderPhase === 'requesting'}
                        aria-busy={recorderPhase === 'processing' || recorderPhase === 'requesting'}
                        icon={recorderPhase === 'processing' || recorderPhase === 'requesting'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : recorderPhase === 'recording'
                                ? <Square className="h-3.5 w-3.5 fill-current" />
                                : <Mic className="h-3.5 w-3.5" />}
                        label={recorderPhase === 'processing'
                            ? t('recorder.processing')
                            : recorderPhase === 'recording'
                                ? t('recorder.stop')
                                : t('recorder.start')}
                        onClick={recorderPhase === 'recording'
                            ? stopRecording
                            : () => {
                                stopContrastAudio();
                                if (autoRecordFlow && !localRecording) {
                                    triggerAutoFlow();
                                } else {
                                    setRecordingSeconds(0);
                                    playMicReadyCue();
                                    void startRecording();
                                }
                            }}
                    />

                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Volume2 className="h-3.5 w-3.5" />}
                        label={t('panel.playSentence')}
                        // 非空闲态（请求授权/录音/评分）禁用试听：防止竞态或把外放原声录进评分音频
                        isDisabled={recorderBusy}
                        onClick={() => {
                            stopContrastAudio();
                            onReplay();
                        }}
                    />

                    <Button
                        variant="ghost"
                        size="sm"
                        label="0.75×"
                        isDisabled={recorderBusy}
                        onClick={() => {
                            stopContrastAudio();
                            onSlowReplay();
                        }}
                    />

                    {playableMineUrl && (
                        <>
                            <Button
                                variant={abPhase !== 'idle' ? 'secondary' : 'ghost'}
                                size="sm"
                                icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
                                label={abPhase !== 'idle'
                                    ? t('shadowing.abStop', { defaultValue: '停止对比' })
                                    : t('shadowing.abButton', { defaultValue: 'A/B 对比' })}
                                isDisabled={recorderBusy}
                                onClick={triggerABContrast}
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                icon={<Volume2 className="h-3.5 w-3.5" />}
                                label={t('result.playMine')}
                                isDisabled={recorderBusy}
                                onClick={() => {
                                    stopContrastAudio();
                                    playMineAudioOnly(playableMineUrl);
                                }}
                            />
                        </>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-sm text-secondary">
                        <Switch
                            label={t('shadowing.autoFlow', { defaultValue: '播完自动开麦' })}
                            value={autoRecordFlow}
                            isDisabled={recorderBusy}
                            onChange={(val) => setAutoRecordFlow(val)}
                        />
                    </div>
                    {(localRecording || result) && (
                        <Button
                            variant="primary"
                            size="sm"
                            label={t('panel.nextSentenceEnter', { defaultValue: '下一句 ↵' })}
                            // 非空闲态禁止切句：防止重挂载静默丢弃录音或评分结果
                            isDisabled={recorderBusy}
                            onClick={onNextSentence}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * 跟读节奏反馈：语速、重读位置与可解释提示。
 *
 * 只展示本地声学信号，不冒充发音准确度评分。
 */
export function RhythmFeedback({
    feedback,
    trend,
}: {
    feedback: NonNullable<SentencePracticeResultVO['rhythm']>;
    trend?: RhythmTrendVO | null;
}) {
    const { t } = useTranslation('practice');
    const paceLabel = feedback.pace === 'fast'
        ? t('rhythm.paceFast', { defaultValue: '偏快' })
        : feedback.pace === 'slow'
            ? t('rhythm.paceSlow', { defaultValue: '偏慢' })
            : feedback.pace === 'steady'
                ? t('rhythm.paceSteady', { defaultValue: '接近原速' })
                : null;
    const noteText = (note: (typeof feedback.notes)[number]): string => {
        if (note === 'pace-fast') return t('rhythm.noteFast', { defaultValue: '整体语速偏快，重读容易糊在一起。' });
        if (note === 'pace-slow') return t('rhythm.noteSlow', { defaultValue: '整体语速偏慢，可以试着更连贯地连读。' });
        if (note === 'syllables-fewer') {
            return t('rhythm.noteSyllablesFewer', {
                defaultValue: '比参考音节少了一些，可能有音节被吞掉或连读过度。',
            });
        }
        if (note === 'syllables-more') {
            return t('rhythm.noteSyllablesMore', {
                defaultValue: '比参考音节多了一些，可能把辅音拆成了独立音节。',
            });
        }
        if (note === 'stress-shifted') {
            return t('rhythm.noteStressShifted', {
                defaultValue: '多数词的重音位置和词典不同，试着把重音放回标注的音节。',
            });
        }
        return t('rhythm.noteFlat', { defaultValue: '重音起伏不明显，找一两个关键词说得更重。' });
    };

    return (
        <div
            data-testid="practice-rhythm-feedback"
            className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-body/50 px-3 py-2"
        >
            <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                <span className="font-medium text-primary">
                    {t('rhythm.title', { defaultValue: '节奏与重读' })}
                </span>
                {paceLabel && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-metadata tabular-nums">
                        {t('rhythm.pace', {
                            defaultValue: '语速 {{pace}}',
                            pace: paceLabel,
                        })}
                    </span>
                )}
                {feedback.paceRatio !== null && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-metadata tabular-nums">
                        {feedback.paceRatio.toFixed(2)}×
                    </span>
                )}
                {feedback.syllables && feedback.syllables.verdict !== 'unknown' && (
                    <span
                        className="rounded-full bg-muted px-2 py-0.5 font-mono text-metadata tabular-nums"
                        title={t('rhythm.syllablesHint', {
                            defaultValue: '参考 {{reference}} 个音节，按语速估算你说了约 {{estimated}} 个',
                            reference: feedback.syllables.reference,
                            estimated: feedback.syllables.estimated,
                        })}
                    >
                        {feedback.syllables.estimated}/{feedback.syllables.reference}
                    </span>
                )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm leading-relaxed">
                {feedback.words.map((word, index) => (
                    <span
                        key={`${word.word}-${index}`}
                        title={word.durationSec === null
                            ? t('rhythm.missingWord', { defaultValue: '这句没有说完整' })
                            : word.phonetic
                                ? `${word.phonetic}${word.stressAligned === false ? ` · ${t('rhythm.stressShiftedWord', { defaultValue: '重音位置与词典不同' })}` : ''}`
                                : undefined}
                        className={cn(
                            'transition-colors',
                            word.stressAligned === false
                                ? 'font-semibold text-warning-text underline decoration-warning/50 decoration-2 underline-offset-4'
                                : word.stressed
                                ? 'font-semibold text-accent underline decoration-accent/50 decoration-2 underline-offset-4'
                                : word.durationSec === null
                                    ? 'text-secondary/50 line-through'
                                    : 'text-primary/80',
                        )}
                    >
                        {word.word}
                    </span>
                ))}
            </div>
            {feedback.notes.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-sm leading-relaxed text-secondary">
                    {feedback.notes.map((note) => (
                        <li key={note}>{noteText(note)}</li>
                    ))}
                </ul>
            )}
            {trend && trend.verdict !== 'insufficient' && trend.points.length > 0 && (
                <div
                    data-testid="practice-rhythm-trend"
                    className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-1.5 text-metadata text-secondary"
                >
                    <span className="font-medium text-primary">
                        {t('rhythm.trendTitle', { defaultValue: '最近几次' })}
                    </span>
                    <span
                        className={cn(
                            'rounded-full px-2 py-0.5 font-medium',
                            trend.verdict === 'improving'
                                ? 'bg-success/10 text-success-text'
                                : trend.verdict === 'regressing'
                                    ? 'bg-warning/10 text-warning-text'
                                    : 'bg-muted text-secondary',
                        )}
                    >
                        {trend.verdict === 'improving'
                            ? t('rhythm.trendImproving', { defaultValue: '在变稳' })
                            : trend.verdict === 'regressing'
                                ? t('rhythm.trendRegressing', { defaultValue: '有波动' })
                                : t('rhythm.trendSteady', { defaultValue: '基本持平' })}
                    </span>
                    <span className="font-mono tabular-nums">
                        {t('rhythm.trendSamples', {
                            defaultValue: '{{count}} 次有录音的练习',
                            count: trend.points.length,
                        })}
                    </span>
                    {trend.stressDelta !== null && trend.stressDelta !== 0 && (
                        <span className="font-mono tabular-nums">
                            {t('rhythm.trendStress', {
                                defaultValue: '重音错位 {{delta}}',
                                delta: trend.stressDelta > 0 ? `+${trend.stressDelta}` : trend.stressDelta,
                            })}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * 统一跟读工作台入口：按子风格在「节拍跟读」与「录音对比」间切换。
 */
export default function ShadowingStudio(props: ShadowingStudioProps) {
    if (props.style === 'beat') {
        return <BeatShadowingView unit={props.unit} translationText={props.translationText} />;
    }
    return <RecordShadowingView key={props.unit.key} {...props} />;
}
