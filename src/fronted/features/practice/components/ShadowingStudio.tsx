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
import UrlUtil from '@/common/utils/UrlUtil';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { useTrainingModeStore } from '@/fronted/features/player/trainingStore';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { cn } from '@/fronted/lib/utils';
import { decodeRecordedAudioSummary, playMicReadyCue } from '../audioFeedback';
import type { PracticeUnit } from '../practiceUnit';
import usePracticePanel, { type ShadowingStyle } from '../practiceStore';
import { usePracticeRecorder, type RecordedAudioArtifact } from '../usePracticeRecorder';
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
    onScoreRecording: (audio: Uint8Array) => Promise<SentencePracticeResultVO | null>;
    onReplay: () => void;
    onSlowReplay: () => void;
    onNextSentence: () => void;
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
                <div className="flex items-center justify-between text-xs font-medium text-success-text">
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
                <p className="text-sm text-muted-foreground leading-relaxed">{translationText}</p>
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
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                    <button
                        type="button"
                        aria-label={t('shadowing.ratioDecrease', { defaultValue: '缩短停顿倍率' })}
                        onClick={() => adjustRatio(-0.2)}
                        className="rounded p-1 hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                        <Minus className="h-3 w-3" />
                    </button>
                    <span className="px-1 font-mono tabular-nums text-foreground">
                        {t('shadowing.beatRatioLabel', { defaultValue: '句末停顿 {{ratio}}×', ratio: shadowingRatio.toFixed(1) })}
                    </span>
                    <button
                        type="button"
                        aria-label={t('shadowing.ratioIncrease', { defaultValue: '延长停顿倍率' })}
                        onClick={() => adjustRatio(0.2)}
                        className="rounded p-1 hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
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
    onScoreRecording,
    onReplay,
    onSlowReplay,
    onNextSentence,
}: Omit<ShadowingStudioProps, 'style'>) {
    const { t } = useTranslation('practice');
    const autoRecordFlow = usePracticePanel((s) => s.autoRecordFlow);
    const setAutoRecordFlow = usePracticePanel((s) => s.setAutoRecordFlow);

    const [localRecording, setLocalRecording] = useState<LocalRecordingSnapshot | null>(null);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [abPhase, setAbPhase] = useState<AbContrastPhase>('idle');

    const liveBarRefs = useRef<Array<HTMLSpanElement | null>>([]);
    const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
    const abRunIdRef = useRef(0);
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
        playbackAudioRef.current?.pause();
        playbackAudioRef.current = null;
        setAbPhase('idle');
    }, []);

    // 卸载时回收本地录音 ObjectURL、对比计时器与回放音轨（换句靠外层 key={unit.key} 重挂载清理）
    useEffect(() => () => {
        if (autoCueTimerRef.current !== null) {
            clearTimeout(autoCueTimerRef.current);
        }
        abRunIdRef.current += 1;
        if (abTimerRef.current !== null) {
            clearTimeout(abTimerRef.current);
        }
        playbackAudioRef.current?.pause();
        playbackAudioRef.current = null;
        if (localUrlRef.current) {
            URL.revokeObjectURL(localUrlRef.current);
            localUrlRef.current = null;
        }
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
            if (localUrlRef.current) {
                URL.revokeObjectURL(localUrlRef.current);
            }
            localUrlRef.current = nextUrl;
            const summary = await decodeRecordedAudioSummary(artifact.blob, STATIC_WAVE_BIN_COUNT);
            setLocalRecording({
                audioUrl: nextUrl,
                bins: summary.bins,
                durationMs: summary.durationMs > 0 ? summary.durationMs : artifact.durationMs,
            });
        }
        if (asrReady) {
            await onScoreRecording(audio);
        }
    }, [asrReady, onScoreRecording]);

    const { phase: recorderPhase, start: startRecording, stop: stopRecording } = usePracticeRecorder({
        onRecordingComplete: handleRecordingComplete,
        active: true,
        vadAutoStop: autoRecordFlow,
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

    const playMineAudioOnly = useCallback((url: string, onEnd?: () => void) => {
        playbackAudioRef.current?.pause();
        const audio = new Audio(url);
        playbackAudioRef.current = audio;
        audio.onended = () => onEnd?.();
        void audio.play().catch((error) => {
            logger.error('跟读录音回放失败', { error });
            toast.error(t('recorder.playbackFailed'));
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
        setAbPhase('playing-original');
        playerActions.playPracticeClip(unit.range, unit.anchor, {
            onEnded: () => {
                if (abRunIdRef.current !== runId) return;
                setAbPhase('gap');
                abTimerRef.current = setTimeout(() => {
                    if (abRunIdRef.current !== runId) return;
                    setAbPhase('playing-mine');
                    playMineAudioOnly(playableMineUrl, () => {
                        if (abRunIdRef.current === runId) {
                            setAbPhase('idle');
                        }
                    });
                }, 280);
            },
        });
    }, [abPhase, playMineAudioOnly, playableMineUrl, stopContrastAudio, unit]);

    const triggerAutoFlow = useCallback(() => {
        stopContrastAudio();
        playerActions.playPracticeClip(unit.range, unit.anchor, {
            onEnded: () => {
                playMicReadyCue();
                autoCueTimerRef.current = setTimeout(() => {
                    setRecordingSeconds(0);
                    void startRecording();
                }, 180);
            },
        });
    }, [startRecording, stopContrastAudio, unit]);

    // 键盘交互：Space 对讲/启停、V 键 A/B 对比、Tab/Shift+Tab 重播、Enter 下一句
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }
            if (e.key === ' ') {
                if (e.repeat) return;
                e.preventDefault();
                if (recorderPhase === 'idle') {
                    stopContrastAudio();
                    pttDownAtRef.current = Date.now();
                    setRecordingSeconds(0);
                    void startRecording();
                } else if (recorderPhase === 'recording') {
                    pttDownAtRef.current = null;
                    stopRecording();
                }
                return;
            }
            if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (playableMineUrl && recorderPhase === 'idle') {
                    e.preventDefault();
                    triggerABContrast();
                }
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && recorderPhase === 'idle' && (result || localRecording)) {
                e.preventDefault();
                onNextSentence();
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key !== ' ' || pttDownAtRef.current === null) return;
            const heldMs = Date.now() - pttDownAtRef.current;
            pttDownAtRef.current = null;
            if (heldMs >= PUSH_TO_TALK_HOLD_MS && recorderPhase === 'recording') {
                stopRecording();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [
        localRecording,
        onNextSentence,
        playableMineUrl,
        recorderPhase,
        result,
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
        <div className="flex flex-col gap-2.5">
            {/* 原句区：有 ASR 识别结果时直接原地差分高亮，平时保留干净原文与划词查词 */}
            <PracticeDiffSentence unit={unit} result={result} />
            {translationText ? (
                <p className="text-sm text-muted-foreground leading-relaxed">{translationText}</p>
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
                                <span className="text-xs font-mono tabular-nums text-error-text">
                                    {recordingSeconds}s{autoRecordFlow ? ` · ${t('shadowing.vadListening', { defaultValue: '停顿自动停麦' })}` : ''}
                                </span>
                            </>
                        ) : localRecording ? (
                            <div className="flex items-center gap-[2px] h-6" aria-hidden>
                                {localRecording.bins.map((bin, idx) => (
                                    <span
                                        key={idx}
                                        className={cn(
                                            'w-[2.5px] rounded-full transition-colors',
                                            abPhase === 'playing-mine' ? 'bg-accent' : 'bg-foreground/45',
                                        )}
                                        style={{ height: `${Math.round(Math.max(4, bin * 22))}px` }}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        {abPhase !== 'idle' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">
                                <Radio className="h-3 w-3 animate-pulse" />
                                {abPhase === 'playing-original'
                                    ? t('shadowing.abOriginal', { defaultValue: '原声 (A)' })
                                    : abPhase === 'playing-mine'
                                        ? t('shadowing.abMine', { defaultValue: '我的录音 (B)' })
                                        : '…'}
                            </span>
                        )}
                        {speedRatio !== null && (
                            <span className="rounded-full bg-background/80 border border-border/50 px-2 py-0.5 font-mono tabular-nums text-muted-foreground">
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

            {!asrReady && !localRecording && recorderPhase === 'idle' && (
                <p className="text-xs text-muted-foreground flex items-center justify-between gap-2">
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
                        isDisabled={recorderPhase === 'processing'}
                        icon={recorderPhase === 'processing'
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
                                    void startRecording();
                                }
                            }}
                    />

                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<Volume2 className="h-3.5 w-3.5" />}
                        label={t('panel.playSentence')}
                        onClick={() => {
                            stopContrastAudio();
                            onReplay();
                        }}
                    />

                    <Button
                        variant="ghost"
                        size="sm"
                        label="0.75×"
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
                                onClick={triggerABContrast}
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                icon={<Volume2 className="h-3.5 w-3.5" />}
                                label={t('result.playMine')}
                                onClick={() => {
                                    stopContrastAudio();
                                    playMineAudioOnly(playableMineUrl);
                                }}
                            />
                        </>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch
                            label={t('shadowing.autoFlow', { defaultValue: '播完自动开麦' })}
                            value={autoRecordFlow}
                            onChange={(val) => setAutoRecordFlow(val)}
                        />
                    </div>
                    {(localRecording || result) && (
                        <Button
                            variant="primary"
                            size="sm"
                            label={t('panel.nextSentenceEnter', { defaultValue: '下一句 ↵' })}
                            onClick={onNextSentence}
                        />
                    )}
                </div>
            </div>
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
