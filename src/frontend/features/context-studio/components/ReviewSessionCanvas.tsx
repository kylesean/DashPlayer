import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import {
    ArrowLeft,
    BookOpenText,
    CheckCircle2,
    ExternalLink,
    Eye,
    Sparkles,
    Volume2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import type { WordContextOccurrence } from '@/common/types/contextStudio';
import type { ReviewCardVO, ReviewRateResultVO, ReviewRating } from '@/common/types/review';
import type { WordItem } from '@/frontend/features/video-learning/components/WordSidebar';
import { contextStudioApi } from '@/frontend/features/context-studio/contextStudioApi';
import { videoLearningApi } from '@/frontend/features/video-learning/videoLearningApi';
import { playContextAudio, stopActiveAudio } from '@/frontend/infrastructure/audio/AudioPlayer';
import { cn } from '@/frontend/lib/utils';

interface ReviewSessionCanvasProps {
    cards: ReviewCardVO[];
    allWords: WordItem[];
    topicLabel?: string | null;
    onSwitchToDueQueue?: () => void;
    onRated: (word: string, result: ReviewRateResultVO) => void;
    onOpenWord: (word: string) => void;
    onExit: () => void;
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将例句中的目标单词替换为掩码或高亮片段，避免剧透答案。
 */
function renderContextSentence(
    text: string,
    targetWord: string,
    revealed: boolean,
) {
    const cleanWord = targetWord.trim();
    if (!cleanWord) {
        return text;
    }
    const regex = new RegExp(`(\\b${escapeRegExp(cleanWord)}\\w*)`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) {
        return text;
    }

    return parts.map((part, idx) => {
        if (idx % 2 === 1) {
            if (!revealed) {
                return (
                    <span
                        key={idx}
                        className="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md bg-muted border border-border/50 text-secondary font-medium select-none"
                    >
                        _____
                    </span>
                );
            }
            return (
                <span
                    key={idx}
                    className="font-semibold text-accent underline decoration-accent/50 underline-offset-4"
                >
                    {part}
                </span>
            );
        }
        return <span key={idx}>{part}</span>;
    });
}

const RATING_OPTIONS: ReadonlyArray<{
    rating: ReviewRating;
    keyHint: string;
    defaultLabel: string;
    variant: 'destructive' | 'secondary' | 'primary';
}> = [
    { rating: 'again', keyHint: '1', defaultLabel: '忘记了', variant: 'destructive' },
    { rating: 'hard', keyHint: '2', defaultLabel: '有点模糊', variant: 'secondary' },
    { rating: 'good', keyHint: '3', defaultLabel: '想起来了', variant: 'secondary' },
    { rating: 'easy', keyHint: '4', defaultLabel: '秒记', variant: 'primary' },
];

/**
 * 语境工坊主动回忆（Active Recall）SRS 复习画布（P0）。
 *
 * 与精读文稿（输入理解）职责严格隔离：专注记忆提取测试、原生语境听音提示、
 * 遮罩/揭示切换与 FSRS 四档评分推进队列。
 */
export function ReviewSessionCanvas({
    cards,
    allWords,
    topicLabel,
    onSwitchToDueQueue,
    onRated,
    onOpenWord,
    onExit,
}: ReviewSessionCanvasProps) {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();

    // 锁定本轮复习队列，避免父组件因单卡评分移除到期列表而造成下标跳变
    const [sessionCards] = useState<ReviewCardVO[]>(() => cards);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [revealed, setRevealed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [playingAudio, setPlayingAudio] = useState(false);
    const [recalledCount, setRecalledCount] = useState(0);
    const [lapseCount, setLapseCount] = useState(0);
    const [loadedContexts, setLoadedContexts] = useState<{
        word: string;
        items: WordContextOccurrence[];
    } | null>(null);

    const currentCard = sessionCards[currentIndex] ?? null;
    const isCompleted = sessionCards.length > 0 && currentIndex >= sessionCards.length;

    const matchedWordItem = useMemo(() => {
        if (!currentCard) return null;
        return allWords.find((w) => w.word.toLowerCase() === currentCard.word.toLowerCase()) ?? null;
    }, [allWords, currentCard]);

    useEffect(() => {
        if (!currentCard || typeof contextStudioApi.getWordContexts !== 'function') {
            return;
        }
        let cancelled = false;
        void contextStudioApi
            .getWordContexts(currentCard.word)
            .then((items) => {
                if (!cancelled) {
                    setLoadedContexts({ word: currentCard.word, items });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setLoadedContexts({ word: currentCard.word, items: [] });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [currentCard]);

    useEffect(() => {
        return () => {
            stopActiveAudio();
        };
    }, []);

    const activeContexts = useMemo(() => {
        if (!currentCard || loadedContexts?.word !== currentCard.word) {
            return [];
        }
        return loadedContexts.items;
    }, [currentCard, loadedContexts]);

    // 优先选用带原生视频时间戳的语境，否则回退到卡片自带语境
    const primaryContext = useMemo(() => {
        const withClip = activeContexts.find(
            (item) => Boolean(item.videoPath && item.startTime !== undefined && item.endTime !== undefined),
        );
        if (withClip) {
            return {
                text: withClip.context,
                contextZh: withClip.contextZh,
                videoId: withClip.videoId,
                videoTitle: withClip.videoTitle,
                videoPath: withClip.videoPath,
                sentenceIndex: withClip.sentenceIndex,
                startTime: withClip.startTime,
                endTime: withClip.endTime,
            };
        }
        if (activeContexts[0]) {
            const first = activeContexts[0];
            return {
                text: first.context,
                contextZh: first.contextZh,
                videoId: first.videoId,
                videoTitle: first.videoTitle,
                videoPath: first.videoPath,
                sentenceIndex: first.sentenceIndex,
                startTime: first.startTime,
                endTime: first.endTime,
            };
        }
        if (currentCard?.context) {
            return {
                text: currentCard.context.text,
                contextZh: undefined,
                videoId: currentCard.context.videoId ?? undefined,
                videoTitle: currentCard.context.videoFileName ?? undefined,
                videoPath: undefined,
                sentenceIndex: currentCard.context.sentenceIndex ?? undefined,
                startTime: undefined,
                endTime: undefined,
            };
        }
        return null;
    }, [activeContexts, currentCard]);

    const handlePlayWord = useCallback(async () => {
        if (!currentCard) return;
        setPlayingAudio(true);
        try {
            await playContextAudio({ text: currentCard.word });
        } finally {
            setPlayingAudio(false);
        }
    }, [currentCard]);

    const handlePlayContext = useCallback(async () => {
        if (!primaryContext) return;
        setPlayingAudio(true);
        try {
            await playContextAudio({
                text: primaryContext.text,
                videoPath: primaryContext.videoPath,
                startTime: primaryContext.startTime,
                endTime: primaryContext.endTime,
            });
        } finally {
            setPlayingAudio(false);
        }
    }, [primaryContext]);

    const handleRate = useCallback(
        async (rating: ReviewRating) => {
            if (!currentCard || submitting) return;
            setSubmitting(true);
            stopActiveAudio();
            try {
                const res = await videoLearningApi.rateReview(
                    currentCard.word,
                    rating,
                    primaryContext?.videoId ? { videoId: primaryContext.videoId } : undefined,
                );
                onRated(currentCard.word, res);
                if (rating === 'good' || rating === 'easy') {
                    setRecalledCount((prev) => prev + 1);
                } else {
                    setLapseCount((prev) => prev + 1);
                }
                setRevealed(false);
                setCurrentIndex((prev) => prev + 1);
            } catch {
                toast.error(t('contextStudio.reviewRateFailed', { defaultValue: '提交反馈失败' }));
            } finally {
                setSubmitting(false);
            }
        },
        [currentCard, submitting, primaryContext, onRated, t],
    );

    // 键盘快捷键：Space 显示答案；1-4 直接评分
    useEffect(() => {
        if (!currentCard || isCompleted) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
            ) {
                return;
            }
            if (event.code === 'Space' && !revealed) {
                event.preventDefault();
                setRevealed(true);
                return;
            }
            if (revealed) {
                if (event.key === '1') {
                    event.preventDefault();
                    void handleRate('again');
                } else if (event.key === '2') {
                    event.preventDefault();
                    void handleRate('hard');
                } else if (event.key === '3') {
                    event.preventDefault();
                    void handleRate('good');
                } else if (event.key === '4') {
                    event.preventDefault();
                    void handleRate('easy');
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [currentCard, isCompleted, revealed, handleRate]);

    if (sessionCards.length === 0) {
        return (
            <Card padding={6} height="100%" className="h-full min-h-0 flex flex-col items-center justify-center">
                <div className="max-w-md flex flex-col items-center text-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-success/10 text-success-text flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <h2 className="text-xl font-semibold text-primary">
                            {t('contextStudio.reviewAllClearTitle', { defaultValue: '今日待复习已全部清零' })}
                        </h2>
                        <Text type="body" color="secondary">
                            {t('contextStudio.reviewAllClearDesc', {
                                defaultValue: '当前没有到期需要巩固的生词，可以在工作台继续浏览词汇或金句。',
                            })}
                        </Text>
                    </div>
                    <Button
                        size="md"
                        variant="primary"
                        icon={<ArrowLeft className="w-4 h-4" />}
                        label={t('contextStudio.backToWorkspace', { defaultValue: '返回工作台' })}
                        onClick={onExit}
                    />
                </div>
            </Card>
        );
    }

    if (isCompleted) {
        const total = sessionCards.length;
        const retentionPct = Math.round((recalledCount / total) * 100);
        return (
            <Card padding={6} height="100%" className="h-full min-h-0 flex flex-col items-center justify-center">
                <div className="max-w-md w-full flex flex-col items-center text-center gap-5">
                    <div className="w-12 h-12 rounded-xl bg-accent-bg/15 text-accent flex items-center justify-center">
                        <Sparkles className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <h2 className="text-xl font-semibold text-primary">
                            {t('contextStudio.reviewCompleteTitle', { defaultValue: '本轮语境复习已完成' })}
                        </h2>
                        <Text type="body" color="secondary">
                            {t('contextStudio.reviewCompleteDesc', {
                                count: total,
                                defaultValue: `共完成 ${total} 个到期词汇的主动回忆训练，FSRS 已自动重排下次复习时间。`,
                            })}
                        </Text>
                    </div>

                    <div className="w-full grid grid-cols-3 gap-2.5">
                        <div className="rounded-lg border border-border/50 bg-surface p-3 flex flex-col gap-1">
                            <span className="text-metadata text-secondary">
                                {t('contextStudio.reviewStatTotal', { defaultValue: '本次完成' })}
                            </span>
                            <span className="text-lg font-semibold text-primary tabular-nums">{total}</span>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-surface p-3 flex flex-col gap-1">
                            <span className="text-metadata text-secondary">
                                {t('contextStudio.reviewStatRecalled', { defaultValue: '回忆成功' })}
                            </span>
                            <span className="text-lg font-semibold text-success-text tabular-nums">{recalledCount}</span>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-surface p-3 flex flex-col gap-1">
                            <span className="text-metadata text-secondary">
                                {t('contextStudio.reviewStatRetention', { defaultValue: '回忆率' })}
                            </span>
                            <span className="text-lg font-semibold text-primary tabular-nums">{retentionPct}%</span>
                        </div>
                    </div>

                    {lapseCount > 0 && (
                        <p className="text-metadata text-secondary">
                            {t('contextStudio.reviewLapseHint', {
                                count: lapseCount,
                                defaultValue: `其中 ${lapseCount} 个词汇已标记需短期加密巩固`,
                            })}
                        </p>
                    )}

                    <Button
                        size="md"
                        variant="primary"
                        icon={<ArrowLeft className="w-4 h-4" />}
                        label={t('contextStudio.backToWorkspace', { defaultValue: '返回工作台' })}
                        onClick={onExit}
                    />
                </div>
            </Card>
        );
    }

    const meaningText =
        matchedWordItem?.translate?.trim() ||
        currentCard.translate?.trim() ||
        t('contextStudio.noTranslation', { defaultValue: '暂无释义' });
    const progressPercent = Math.round(((currentIndex + 1) / sessionCards.length) * 100);

    return (
        <Card padding={0} height="100%" className="h-full min-h-0 flex flex-col overflow-hidden">
            {/* 复习顶栏与进度条 */}
            <div className="px-5 py-3.5 border-b border-border/40 bg-surface/40 flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<ArrowLeft className="w-3.5 h-3.5" />}
                        label={t('contextStudio.exitReview', { defaultValue: '退出复习' })}
                        onClick={onExit}
                    />
                    {topicLabel && (
                        <div className="flex items-center gap-1.5 min-w-0">
                            <Badge
                                variant="info"
                                label={t('contextStudio.topicReviewBadge', {
                                    topic: topicLabel,
                                    defaultValue: `专题 · ${topicLabel}`,
                                })}
                            />
                            {onSwitchToDueQueue && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    label={t('contextStudio.backToDueQueue', { defaultValue: '切回今日到期' })}
                                    onClick={onSwitchToDueQueue}
                                />
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-secondary shrink-0">
                        <span className="font-medium text-primary tabular-nums">
                            {t('contextStudio.reviewProgress', {
                                current: currentIndex + 1,
                                total: sessionCards.length,
                                defaultValue: `第 ${currentIndex + 1} / ${sessionCards.length} 张`,
                            })}
                        </span>
                        <span className="text-metadata text-secondary/80 tabular-nums">
                            ({progressPercent}%)
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <div className="w-36 h-1.5 rounded-full bg-border/40 overflow-hidden">
                        <div
                            className="h-full bg-accent transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                    <Badge
                        variant="info"
                        label={t('contextStudio.reviewRecallStatsBadge', {
                            recalled: recalledCount,
                            lapse: lapseCount,
                            defaultValue: `记住 ${recalledCount} · 重温 ${lapseCount}`,
                        })}
                    />
                </div>
            </div>

            {/* 中央主动回忆闪卡 */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col items-center justify-center">
                <div className="w-full max-w-2xl flex flex-col gap-5">
                    <div className="rounded-xl border border-border/50 bg-surface p-6 shadow-xs flex flex-col gap-5">
                        {/* 词头与调度元数据 */}
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-4">
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-2.5">
                                    <h2 className="text-xl font-semibold tracking-tight text-primary">
                                        {currentCard.word}
                                    </h2>
                                    <Tooltip content={t('contextStudio.speakWord', { defaultValue: '发音' })} placement="below">
                                        <button
                                            type="button"
                                            disabled={playingAudio}
                                            onClick={() => void handlePlayWord()}
                                            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-muted/80 transition-colors cursor-pointer disabled:opacity-50"
                                            aria-label={t('contextStudio.speakWord', { defaultValue: '发音' })}
                                        >
                                            <Volume2 className="w-4 h-4" />
                                        </button>
                                    </Tooltip>
                                    <Badge
                                        variant={(currentCard.schedule?.lapses ?? 0) > 0 ? 'warning' : 'neutral'}
                                        label={t(`contextStudio.status.${currentCard.status}`, {
                                            defaultValue:
                                                currentCard.status === 'learning'
                                                    ? '待学'
                                                    : currentCard.status === 'familiar'
                                                        ? '有印象'
                                                        : currentCard.status === 'known'
                                                            ? '已掌握'
                                                            : '已忽略',
                                        })}
                                    />
                                </div>
                                <div className="flex items-center gap-3 text-metadata text-secondary">
                                    <span>
                                        {t('contextStudio.reviewCount', {
                                            count: currentCard.schedule?.reps ?? 0,
                                            defaultValue: `已复习 ${currentCard.schedule?.reps ?? 0} 次`,
                                        })}
                                    </span>
                                    <span>
                                        {t('contextStudio.reviewStability', {
                                            days: (currentCard.schedule?.stability ?? 0).toFixed(1),
                                            defaultValue: `记忆稳定度 ${(currentCard.schedule?.stability ?? 0).toFixed(1)} 天`,
                                        })}
                                    </span>
                                </div>
                            </div>

                            <Button
                                size="sm"
                                variant="secondary"
                                label={t('contextStudio.reviewInspectWord', { defaultValue: '查看完整词条' })}
                                onClick={() => onOpenWord(currentCard.word)}
                            />
                        </div>

                        {/* 真实语境提示区（遮罩模式优先测试回忆，揭示后高亮+附译文） */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-metadata font-medium text-secondary">
                                    {t('contextStudio.reviewContextCue', { defaultValue: '真实视频语境' })}
                                </span>
                                {primaryContext && (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        icon={<Volume2 className="w-3.5 h-3.5" />}
                                        isDisabled={playingAudio}
                                        label={
                                            primaryContext.videoPath && primaryContext.startTime !== undefined
                                                ? t('contextStudio.playNativeAudio', { defaultValue: '播放原声' })
                                                : t('contextStudio.speakSentence', { defaultValue: '朗读语境' })
                                        }
                                        onClick={() => void handlePlayContext()}
                                    />
                                )}
                            </div>

                            {primaryContext ? (
                                <div className="rounded-lg border border-border/40 bg-body/60 p-4 flex flex-col gap-2">
                                    <p className="text-base text-primary leading-relaxed">
                                        {renderContextSentence(primaryContext.text, currentCard.word, revealed)}
                                    </p>
                                    {revealed && primaryContext.contextZh && (
                                        <p className="text-sm text-secondary leading-relaxed">
                                            {primaryContext.contextZh}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-metadata text-secondary">
                                        <span className="truncate">
                                            {primaryContext.videoTitle || t('contextStudio.unknownVideo', { defaultValue: '未知视频' })}
                                        </span>
                                        {revealed && primaryContext.videoId && (
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const query = primaryContext.sentenceIndex !== undefined
                                                            ? `?sentence=${primaryContext.sentenceIndex}`
                                                            : '';
                                                        navigate(`/reader/${primaryContext.videoId}${query}`);
                                                    }}
                                                    className="inline-flex items-center gap-1 text-metadata text-accent hover:underline cursor-pointer"
                                                >
                                                    <BookOpenText className="w-3.5 h-3.5" />
                                                    <span>{t('contextStudio.openInReader', { defaultValue: '精读全文' })}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const tParam = primaryContext.startTime !== undefined
                                                            ? `?t=${Math.floor(primaryContext.startTime)}`
                                                            : '';
                                                        navigate(`/player/${primaryContext.videoId}${tParam}`);
                                                    }}
                                                    className="inline-flex items-center gap-1 text-metadata text-accent hover:underline cursor-pointer"
                                                >
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                    <span>{t('contextStudio.openInPlayer', { defaultValue: '定位播放' })}</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed border-border/50 bg-body/40 p-4 text-sm text-secondary">
                                    {t('contextStudio.emptyContexts', { defaultValue: '暂无关联视频语境，请先根据词形直接回忆释义。' })}
                                </div>
                            )}
                        </div>

                        {/* 释义遮罩 / 揭示区 */}
                        {!revealed ? (
                            <div className="rounded-lg border border-border/40 bg-muted/40 p-5 flex flex-col items-center justify-center gap-3 text-center">
                                <p className="text-sm text-secondary">
                                    {t('contextStudio.reviewRecallInstruction', {
                                        defaultValue: '先在脑海中回想词义与语境用法，再点击下方揭示答案。',
                                    })}
                                </p>
                                <Button
                                    size="md"
                                    variant="primary"
                                    icon={<Eye className="w-4 h-4" />}
                                    label={t('contextStudio.reviewReveal', { defaultValue: '显示答案 (Space)' })}
                                    onClick={() => setRevealed(true)}
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                <div className="rounded-lg border border-accent-bg/30 bg-accent-bg/8 p-4 flex flex-col gap-1.5">
                                    <span className="text-metadata font-medium text-accent">
                                        {t('contextStudio.reviewAnswerLabel', { defaultValue: '词义答案' })}
                                    </span>
                                    <p className="text-base text-primary whitespace-pre-wrap leading-relaxed">
                                        {meaningText}
                                    </p>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <span className="text-metadata font-medium text-secondary">
                                        {t('contextStudio.reviewPromptDesc', {
                                            defaultValue: '选择回忆程度，系统会自动安排下次复习（快捷键 1 - 4）',
                                        })}
                                    </span>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        {RATING_OPTIONS.map((opt) => (
                                            <Button
                                                key={opt.rating}
                                                size="md"
                                                variant={opt.variant}
                                                isDisabled={submitting}
                                                className={cn('justify-center')}
                                                label={`${opt.keyHint} · ${t(`contextStudio.rate${opt.rating[0].toUpperCase()}${opt.rating.slice(1)}`, { defaultValue: opt.defaultLabel })}`}
                                                onClick={() => void handleRate(opt.rating)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Card>
    );
}
