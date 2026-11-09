import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import useSWR from 'swr';
import { Keyboard, Loader2, Mic, Pause, Play, RotateCcw, Square, Volume2, X } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Badge } from '@astryxdesign/core/Badge';
import { TextArea } from '@astryxdesign/core/TextArea';
import { cn } from '@/fronted/lib/utils';
import UrlUtil from '@/common/utils/UrlUtil';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import usePracticePanel from './practiceStore';
import { practiceApi } from './practiceApi';
import { usePracticeRecorder } from './usePracticeRecorder';
import type { SentencePracticeMode, SentencePracticeResultVO, SentencePracticeWordResult } from '@/common/contracts/sentence-practice';

const logger = getRendererLogger('PracticePanel');

/**
 * 评分环:0-100 分的环形指示,颜色按档位区分(绿≥80 / 黄≥50 / 红<50)。
 */
const ScoreRing = ({ score }: { score: number }) => {
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    const color = score >= 80
        ? 'var(--color-success)'
        : score >= 50
            ? 'var(--color-warning)'
            : 'var(--color-error)';
    return (
        <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0">
            <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="6" className="stroke-border" />
            <circle
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                strokeWidth="6"
                stroke={color}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - score / 100)}
                transform="rotate(-90 40 40)"
            />
            <text x="40" y="46" textAnchor="middle" className="fill-primary text-lg font-semibold">
                {score}
            </text>
        </svg>
    );
};

/**
 * 逐词对齐结果展示:按原句词序排列,sub 显示「期望→听到」,missing 划掉期望词。
 */
const WordChips = ({ words }: { words: SentencePracticeWordResult[] }) => (
    <div className="flex flex-wrap gap-1.5">
        {words.map((word, idx) => {
            let labelText: React.ReactNode = word.expected || word.heard;
            let variant: 'success' | 'warning' | 'error' | 'neutral' = 'neutral';

            if (word.status === 'match') {
                variant = 'success';
                labelText = word.expected;
            } else if (word.status === 'sub') {
                variant = 'warning';
                labelText = (
                    <span>
                        {word.expected} <span className="opacity-70 font-normal">→ {word.heard}</span>
                    </span>
                );
            } else if (word.status === 'missing') {
                variant = 'error';
                labelText = <span className="line-through opacity-80">{word.expected}</span>;
            } else {
                variant = 'neutral';
                labelText = word.heard || word.expected;
            }

            return (
                <Badge
                    key={idx}
                    variant={variant}
                    label={labelText}
                />
            );
        })}
    </div>
);

/**
 * 句子跟读/听写练习覆盖面板。
 *
 * 入口在播放画面胶囊(PracticeModeButton),与整句学习页互斥打开:
 * 本面板打开时收起学习页;学习页打开时本面板被其覆盖层遮住。
 * 跟读:录音 → 本地 ASR 转写 → 词级对齐评分;听写:键入 → 词级对齐评分。
 */
const PracticePanel = () => {
    const { t } = useTranslation('practice');
    const visible = usePracticePanel((s) => s.visible);
    const mode = usePracticePanel((s) => s.mode);
    const setMode = usePracticePanel((s) => s.setMode);
    const setVisible = usePracticePanel((s) => s.setVisible);
    const currentSentence = usePlayerState((s) => s.currentSentence);
    const playing = usePlayerState((s) => s.playing);
    const [result, setResult] = useState<SentencePracticeResultVO | null>(null);
    const [typed, setTyped] = useState('');
    const [dictationRevealed, setDictationRevealed] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    // 单路回放会话:同一时刻只放一段录音(原句播放走视频轨,不在此管)
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // 本地 ASR 是否就绪(资源状态聚合里 transcription.ready)
    const { data: resourceStatus } = useSWR('settings/resource-status/detail', () => settingsApi.getResourceStatus());
    const asrReady = resourceStatus?.transcription?.ready ?? false;

    const sentenceKey = currentSentence?.key ?? null;
    // 当前字幕是否意群重切分行:练习记录按 (fileHash, index, resegmented) 隔离,开关切换后序号重排不串档
    const srtResegmented = usePlaybackSession((s) => s.srtResegmented);
    // 换句即清空上一句的评分与输入:渲染期条件重置(React 官方推荐模式),面板总是从干净状态开始
    const [lastSentenceKey, setLastSentenceKey] = useState<string | null>(sentenceKey);
    if (sentenceKey !== lastSentenceKey) {
        setLastSentenceKey(sentenceKey);
        setResult(null);
        setTyped('');
        setDictationRevealed(false);
    }
    const historyKey = currentSentence && visible
        ? ['practice/list-by-sentence', currentSentence.fileHash, currentSentence.index, srtResegmented]
        : null;
    const { data: history, mutate: mutateHistory } = useSWR(
        historyKey,
        () => practiceApi.listBySentence({
            fileHash: currentSentence!.fileHash,
            sentenceIndex: currentSentence!.index,
            resegmented: srtResegmented,
        }),
    );

    const playSentence = (): void => {
        if (!currentSentence) return;
        playerActions.gotoSentence(currentSentence);
        playerActions.play();
    };

    /** 回放自己的跟读录音:先停掉上一路,再从录音文件起播。 */
    const playRecording = (audioPath: string): void => {
        audioRef.current?.pause();
        const audio = new Audio(UrlUtil.toUrl(audioPath));
        audioRef.current = audio;
        void audio.play().catch((error) => {
            logger.error('跟读录音回放失败', { error });
            toast.error(t('recorder.playbackFailed'));
        });
    };

    const submitShadowing = async (audio: Uint8Array): Promise<void> => {
        if (!currentSentence) return;
        const vo = await practiceApi.scoreShadowing({
            fileHash: currentSentence.fileHash,
            sentenceIndex: currentSentence.index,
            resegmented: srtResegmented,
            audio,
            expectedText: currentSentence.text,
        });
        setResult(vo);
        void mutateHistory();
    };

    const submitDictation = async (): Promise<void> => {
        if (!currentSentence) return;
        if (!typed.trim()) {
            toast.error(t('dictation.emptyInput'));
            return;
        }
        try {
            const vo = await practiceApi.scoreDictation({
                fileHash: currentSentence.fileHash,
                sentenceIndex: currentSentence.index,
                resegmented: srtResegmented,
                typedText: typed.trim(),
                expectedText: currentSentence.text,
            });
            setResult(vo);
            setDictationRevealed(true);
            void mutateHistory();
        } catch (error) {
            logger.error('听写评分失败', { error });
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    const { phase: recorderPhase, start: startRecording, stop: stopRecording } =
        usePracticeRecorder({
            onRecordingComplete: submitShadowing,
            // 录音 UI 只在「面板可见 + 停在跟读页签 + 有当前句」时存在。
            // 任一条件失效（切听写、关面板、换到无字幕处）都由 hook 主动丢弃录音，
            // 否则麦克风继续采集、recording 卡在 true 把播放快捷键永久禁用。
            active: visible && mode === 'shadowing' && currentSentence !== null,
        });

    // 录音中的秒数计时:秒数清零在点击处理器里做,effect 只负责计时器生命周期
    useEffect(() => {
        if (visible && recorderPhase === 'recording') {
            const timer = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
            return () => window.clearInterval(timer);
        }
        return undefined;
         
    }, [visible, recorderPhase]);

    // 面板隐藏或组件卸载时停掉录音回放：audio 元素挂在 ref 上，不受 React 卸载影响，
    // 不停就会在用户已经回到播放画面后继续出声。
    useEffect(() => {
        if (visible) {
            return;
        }
        audioRef.current?.pause();
        audioRef.current = null;
    }, [visible]);
    useEffect(() => () => {
        audioRef.current?.pause();
        audioRef.current = null;
    }, []);

    if (!visible || !currentSentence) return null;

    const isDictation = mode === 'dictation';

    return (
        <div className="flex h-full w-full flex-col bg-surface/95 backdrop-blur-2xl text-foreground">
            {/* 头部:标题 + 关闭 */}
            <div className="flex items-center justify-between px-6 pt-4 pb-2">
                <h2 className="text-base font-semibold">{t('panel.title')}</h2>
                <IconButton
                    label={t('common:close', { defaultValue: '关闭' })}
                    icon={<X className="h-4 w-4" />}
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisible(false)}
                />
            </div>

            {/* 原句区:听写模式提交前隐藏原文 */}
            <div className="px-6">
                <div className="rounded-2xl border border-border/70 bg-card p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            label={playing ? t('panel.stop') : t('panel.playSentence')}
                            onClick={playing ? () => playerActions.pause() : playSentence}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={<RotateCcw className="h-3.5 w-3.5" />}
                            label={t('panel.replay')}
                            onClick={playSentence}
                        />
                    </div>
                    {(!isDictation || dictationRevealed || result) ? (
                        <p className="text-lg leading-relaxed font-medium text-foreground">{currentSentence.text}</p>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">{t('dictation.hiddenHint')}</p>
                    )}
                    {currentSentence.textZH && (!isDictation || dictationRevealed || result) && (
                        <p className="text-sm text-muted-foreground">{currentSentence.textZH}</p>
                    )}
                </div>
            </div>

            {/* 模式切换 */}
            <div className="flex items-center gap-1 px-6 pt-3">
                {(['shadowing', 'dictation'] as SentencePracticeMode[]).map((m) => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={cn(
                            'rounded-full px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer',
                            mode === m
                                ? 'bg-foreground text-background'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70',
                        )}
                    >
                        {m === 'shadowing' ? t('panel.tabShadowing') : t('panel.tabDictation')}
                    </button>
                ))}
            </div>

            {/* 练习区 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-4">
                {mode === 'shadowing' ? (
                    <div className="flex flex-col items-center gap-3">
                        {!asrReady && (
                            <div className="w-full rounded-xl border border-warning/40 bg-warning-muted px-4 py-2.5 text-xs text-warning-text">
                                {t('shadowing.asrUnavailable')}
                            </div>
                        )}
                        <button
                            type="button"
                            disabled={!asrReady || recorderPhase === 'processing'}
                            onClick={recorderPhase === 'recording' ? stopRecording : () => {
                                setRecordingSeconds(0);
                                void startRecording();
                            }}
                            className={cn(
                                'flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-full border-2 transition-all cursor-pointer',
                                recorderPhase === 'recording'
                                    ? 'border-error/50 bg-error/10 text-error-text animate-pulse'
                                    : 'border-border bg-card text-foreground hover:border-foreground/40 hover:bg-muted/60',
                                (!asrReady || recorderPhase === 'processing') && 'opacity-50 cursor-not-allowed',
                            )}
                        >
                            {recorderPhase === 'processing' ? (
                                <>
                                    <Loader2 className="h-6 w-6 animate-spin" />
                                    <span className="text-xs">{t('recorder.processing')}</span>
                                </>
                            ) : recorderPhase === 'recording' ? (
                                <>
                                    <Square className="h-6 w-6 fill-current" />
                                    <span className="text-xs tabular-nums">{recordingSeconds}s · {t('recorder.stop')}</span>
                                </>
                            ) : (
                                <>
                                    <Mic className="h-6 w-6" />
                                    <span className="text-xs">{t('recorder.start')}</span>
                                </>
                            )}
                        </button>
                        <p className="text-xs text-muted-foreground">{t('shadowing.hint')}</p>
                    </div>
                ) : (
                    <div
                        className="flex flex-col gap-3"
                        onKeyDown={(e) => {
                            // Ctrl/Cmd+Enter 提交,普通回车换行
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                void submitDictation();
                            }
                        }}
                    >
                        <TextArea
                            label={t('dictation.placeholder')}
                            isLabelHidden
                            value={typed}
                            onChange={(val) => setTyped(val)}
                            placeholder={t('dictation.placeholder')}
                            rows={3}
                            width="100%"
                        />
                        <div className="flex items-center gap-2">
                            <Button
                                variant="primary"
                                size="sm"
                                icon={<Keyboard className="h-3.5 w-3.5" />}
                                label={t('dictation.submit')}
                                onClick={() => void submitDictation()}
                            />
                            <span className="text-xs text-muted-foreground/70">Ctrl + Enter</span>
                        </div>
                    </div>
                )}

                {/* 评分结果 */}
                {result && (
                    <div className="rounded-2xl border border-border/70 bg-card p-4 flex flex-col gap-3">
                        <div className="flex items-center gap-4">
                            <ScoreRing score={result.score} />
                            <div className="flex flex-col gap-1 min-w-0">
                                {result.transcript !== null && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                        <Volume2 className="h-3 w-3 shrink-0" />
                                        <span className="truncate">{t('result.heard')}: {result.transcript || '—'}</span>
                                    </p>
                                )}
                                {result.audioPath && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        icon={<Volume2 className="h-3.5 w-3.5" />}
                                        label={t('result.playMine')}
                                        onClick={() => playRecording(result.audioPath!)}
                                    />
                                )}
                            </div>
                        </div>
                        <WordChips words={result.words} />
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={<RotateCcw className="h-3.5 w-3.5" />}
                                label={t('result.retry')}
                                onClick={() => {
                                    setResult(null);
                                    setDictationRevealed(false);
                                    if (mode === 'shadowing') playSentence();
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* 练习历史 */}
                {history && history.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {t('result.history')}
                        </h3>
                        <div className="flex flex-col divide-y divide-border/40 rounded-xl border border-border/60 overflow-hidden">
                            {history.slice(0, 10).map((record) => (
                                <div key={record.id} className="flex items-center justify-between px-3 py-1.5 text-xs bg-card">
                                    <span className="text-muted-foreground">
                                        {record.mode === 'shadowing' ? t('result.modeShadowing') : t('result.modeDictation')}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        {record.audioPath && (
                                            <button
                                                type="button"
                                                aria-label={t('result.playMine')}
                                                onClick={() => playRecording(record.audioPath!)}
                                                className="text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                <Volume2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                        <span className={cn(
                                            'font-semibold tabular-nums',
                                            record.score >= 80 ? 'text-success-text'
                                                : record.score >= 50 ? 'text-warning-text'
                                                    : 'text-error-text',
                                        )}>
                                            {Math.round(record.score)}
                                        </span>
                                    </span>
                                    <span className="text-xs text-muted-foreground/70">{record.createdAt.slice(5, 16)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PracticePanel;
