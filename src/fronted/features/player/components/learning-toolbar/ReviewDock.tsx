/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { BookOpenCheck, Check, Clapperboard, CornerUpLeft, Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useSWR from 'swr';
import { usePopover } from '@astryxdesign/core/Popover';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { CONTROL_POPOVER_PANEL } from '@/fronted/features/player/components/ControlPopover';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { REVIEW_QUEUE_SWR_KEY } from '@/fronted/features/video-learning/reviewQueue';
import type {
    ReviewCardVO,
    ReviewRating,
    ReviewRetentionStats,
} from '@/common/types/review';
import {
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';
import { formatLearningDue } from './learningTime';
import { useReviewDockStore } from './reviewDockStore';
import { selectReviewBatch } from './reviewBatch';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { useNavigate } from 'react-router-dom';

const RATING_STYLES: Record<ReviewRating, string> = {
    again: 'border-error/30 bg-error/5 text-error-text hover:bg-error/10',
    hard: 'border-warning/30 bg-warning/5 text-warning-text hover:bg-warning/10',
    good: 'border-success/30 bg-success/5 text-success-text hover:bg-success/10',
    easy: 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15',
};

/**
 * 掌握度只展示有解释的档位，不把概率伪装成精确小数。
 *
 * @param mastery 0-1 掌握概率。
 * @param t 翻译函数。
 * @returns 可读的掌握阶段。
 */
const masteryLabel = (mastery: number, t: (key: string) => string): string => {
    if (mastery >= 0.8) return t('reviewDock.masteryStrong');
    if (mastery >= 0.55) return t('reviewDock.masteryGrowing');
    if (mastery >= 0.3) return t('reviewDock.masteryFamiliar');
    return t('reviewDock.masteryNew');
};

/**
 * 置信度表示“有多少证据支撑当前判断”，避免用户误读掌握概率。
 *
 * @param confidence 0-1 置信度。
 * @param t 翻译函数。
 * @returns 可读的证据强度。
 */
const confidenceLabel = (confidence: number, t: (key: string) => string): string => {
    if (confidence >= 0.55) return t('reviewDock.confidenceStrong');
    if (confidence >= 0.25) return t('reviewDock.confidenceSome');
    return t('reviewDock.confidenceLow');
};

/**
 * 7 / 30 天回忆表现：只在有样本时展示，避免空数据伪装成 0% 回忆率。
 */
const RetentionChip = ({
    label,
    stats,
}: {
    label: string;
    stats: ReviewRetentionStats;
}) => {
    if (stats.reviewed === 0 || stats.retention === null) {
        return null;
    }
    return (
        <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-metadata text-muted-foreground">
            {label} {Math.round(stats.retention * 100)}%
        </span>
    );
};

/**
 * 复习卡主体：先只给单词让用户回忆，再揭示释义、掌握阶段与四档反馈。
 */
const ReviewCardBody = ({
    card,
    revealed,
    pending,
    onReveal,
    onRate,
    clipCount,
    onOpenClips,
    revealRef,
}: {
    card: ReviewCardVO;
    revealed: boolean;
    pending: boolean;
    onReveal: () => void;
    onRate: (rating: ReviewRating) => void;
    /** 该词已收藏的真实片段数；0 表示没有片段可看。 */
    clipCount: number;
    /** 打开该词的片段（词汇工坊按词筛选）。 */
    onOpenClips: (word: string) => void;
    /** 评分后把焦点交还给「显示答案」，避免键盘焦点落回 body。 */
    revealRef?: Ref<HTMLButtonElement>;
}) => {
    const { t } = useTranslation('player');
    const statusLabel = card.status === 'familiar'
        ? t('reviewDock.statusFamiliar')
        : t('reviewDock.statusLearning');

    return (
        <div className="rounded-xl border border-border/60 bg-card p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-metadata font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('reviewDock.cardLabel')}
                </span>
                {revealed && (
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-metadata font-medium text-primary">
                        {statusLabel}
                    </span>
                )}
            </div>

            <div className="flex min-h-24 flex-col items-center justify-center py-3 text-center">
                <div
                    data-testid="review-card-word"
                    className="max-w-full break-words text-2xl font-semibold tracking-tight text-foreground"
                >
                    {card.word}
                </div>
                {revealed ? (
                    <>
                        <div className="mt-1.5 max-w-full break-words text-sm text-muted-foreground">
                            {card.translate?.trim() || t('reviewDock.noTranslation')}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-metadata text-muted-foreground/80">
                            <span>{t('reviewDock.mastery')}: {masteryLabel(card.mastery, t)}</span>
                            <span aria-hidden>·</span>
                            <span>{t('reviewDock.evidence')}: {confidenceLabel(card.confidence, t)}</span>
                        </div>
                    </>
                ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                        {t('reviewDock.recallHint')}
                    </p>
                )}
            </div>

            {revealed && clipCount > 0 && (
                <button
                    type="button"
                    data-testid="review-open-clips"
                    onClick={() => onOpenClips(card.word)}
                    className={cn(
                        'mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/25',
                        'h-8 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 cursor-pointer',
                    )}
                >
                    <Clapperboard className="h-3.5 w-3.5 text-accent" />
                    {t('reviewDock.openClips', {
                        count: clipCount,
                        defaultValue: '看这 {{count}} 个片段',
                    })}
                </button>
            )}

            {revealed && card.context && (
                <div
                    data-testid="review-card-context"
                    className="mb-2 rounded-lg bg-muted/45 px-2.5 py-2 text-left"
                >
                    <p className="text-sm leading-relaxed text-foreground/85">
                        “{card.context.text}”
                    </p>
                    {(card.context.videoFileName || card.context.sentenceIndex !== null) && (
                        <p className="mt-1 truncate text-metadata text-muted-foreground">
                            {[
                                card.context.videoFileName
                                    ? t('reviewDock.sourceVideo', { name: card.context.videoFileName })
                                    : null,
                                card.context.sentenceIndex !== null
                                    ? t('reviewDock.sourceSentence', { index: card.context.sentenceIndex + 1 })
                                    : null,
                            ].filter(Boolean).join(' · ')}
                        </p>
                    )}
                </div>
            )}

            {revealed ? (
                <div className="grid grid-cols-2 gap-1.5">
                    {([
                        ['again', t('reviewDock.ratingAgain')],
                        ['hard', t('reviewDock.ratingHard')],
                        ['good', t('reviewDock.ratingGood')],
                        ['easy', t('reviewDock.ratingEasy')],
                    ] as const).map(([rating, label]) => (
                        <button
                            key={rating}
                            type="button"
                            data-testid={`review-rating-${rating}`}
                            disabled={pending}
                            onClick={() => onRate(rating)}
                            className={cn(
                                'h-8 rounded-lg border text-sm font-medium transition-colors cursor-pointer',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
                                'disabled:cursor-wait disabled:opacity-60',
                                RATING_STYLES[rating],
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            ) : (
                <button
                    type="button"
                    ref={revealRef}
                    data-testid="review-reveal"
                    onClick={onReveal}
                    className="h-8 w-full rounded-lg border border-border/70 bg-background/60 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
                >
                    {t('reviewDock.reveal')}
                </button>
            )}
        </div>
    );
};

/**
 * 播放器内复习坞。
 *
 * 不做独立背词页面：入口固定在主字幕学习台，弹层内一次只处理一张到期卡，
 * 先回忆再揭示，评完立即换下一张；关闭后仍停在原视频位置。
 */
export default function ReviewDock({
    tone,
    popoverOffset,
}: {
    tone: ToolbarTone;
    popoverOffset: number;
}) {
    const { t, i18n } = useTranslation('player');
    const navigate = useNavigate();
    const requestId = useReviewDockStore((state) => state.requestId);
    const consumedId = useReviewDockStore((state) => state.consumedId);
    const consumeRequest = useReviewDockStore((state) => state.consume);
    const [revealedFor, setRevealedFor] = useState<string | null>(null);
    const revealButtonRef = useRef<HTMLButtonElement | null>(null);
    const [pending, setPending] = useState(false);
    const [lastRated, setLastRated] = useState<{
        rating: ReviewRating;
        dueAt: string;
    } | null>(null);
    /**
     * 本组已复习的词。
     *
     * 分组的进度必须由「已经处理过什么」推导，而不是在打开时把队列拍成快照：
     * 服务端评完一张就会重新排期，快照会留下一张点不动的幽灵卡。
     */
    const [reviewedWords, setReviewedWords] = useState<string[]>([]);
    // 打开复习坞时记住当时的播放位置：复习是临时插入的动作，结束后应当能回到
    // 刚才那句话，而不是让用户自己拖进度条找回来。
    // `openDock` 与深链 effect 在打开前都会写入 `returnToSecRef`，关闭时重置。
    const returnToSecRef = useRef<number | null>(null);
    const dockEpochRef = useRef(0);
    const handlePopoverHide = useCallback(() => {
        dockEpochRef.current += 1;
        returnToSecRef.current = null;
        setPending(false);
        setRevealedFor(null);
        setLastRated(null);
        // 关闭即结束本组：下次打开从新的一组开始，不把上次的进度带过来。
        setReviewedWords([]);
    }, []);

    const popover = usePopover({
        className: cn('w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden', CONTROL_POPOVER_PANEL),
        hasSurface: false,
        isModal: false,
        dialogLabel: t('reviewDock.title'),
        onHide: handlePopoverHide,
    });

    /**
     * 打开复习坞并记住当前播放位置。
     *
     * 只在「未打开 → 打开」时记录：重复点击不该把位置刷成复习后的时间。
     */
    const openDock = useCallback(() => {
        if (!popover.isOpen) {
            returnToSecRef.current = usePlayer.getState().getExactPlayTime();
        }
        popover.show();
    }, [popover]);

    /**
     * 回到进入复习前的播放位置并关闭弹层。
     */
    const returnToPlayback = useCallback(() => {
        const target = returnToSecRef.current;
        if (target !== null) {
            usePlayer.getState().seekToTarget({ time: target });
        }
        popover.hide();
    }, [popover]);

    /**
     * 每个词有多少个真实片段。
     *
     * 片段此前是独立的一等公民：有 OSS 同步、任务队列、写入器，却完全不参与
     * 复习调度。这里把它接回闭环——复习时看到「有 3 个片段」比看到一句
     * 「已收藏」有用得多，用户能立刻回到真实语境里再听一遍。
     * 失败只降级为「没有片段」，不影响复习本身。
     */
    const { data: clipStats } = useSWR(
        'video-learning/word-clip-stats',
        () => videoLearningApi.getWordClipStats(),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    );

    const { data, error, isLoading, mutate } = useSWR(
        REVIEW_QUEUE_SWR_KEY,
        () => videoLearningApi.getReviewQueue(),
        {
            refreshInterval: 60_000,
            revalidateOnFocus: true,
            shouldRetryOnError: false,
        },
    );

    const style = TOOLBAR_TONE[tone];
    const videoId = usePlaybackSession((state) => state.videoId);
    const fileHash = usePlaybackSession((state) => state.srtHash);
    const dueCount = data?.dueCount ?? 0;
    /**
     * 当前这一组的进度。
     *
     * 到期词可能远多于一组，这里只取前几张：一组是注意力单位，
     * 用户做完一组就知道自己完成了一小段，而不是面对一条看不到头的队列。
     */
    const batch = selectReviewBatch(data?.items ?? [], reviewedWords);
    const card = batch.card;
    const revealed = card !== null && revealedFor === card.word;
    const hasRetentionSample = (data?.stats.last7Days.reviewed ?? 0) > 0
        || (data?.stats.last30Days.reviewed ?? 0) > 0;

    // 首页请求打开：消费请求并显式展开，避免在渲染期派生打开态。
    useEffect(() => {
        if (requestId > consumedId) {
            consumeRequest(requestId);
            if (!popover.isOpen) {
                returnToSecRef.current = usePlayer.getState().getExactPlayTime();
                popover.show();
            }
        }
    }, [requestId, consumedId, consumeRequest, popover]);

    const rate = async (rating: ReviewRating) => {
        if (!card || pending) return;
        const epoch = dockEpochRef.current;
        const targetWord = card.word;
        setPending(true);
        try {
            const result = await videoLearningApi.rateReview(targetWord, rating, {
                videoId: videoId ?? undefined,
                fileHash: fileHash ?? undefined,
            });
            await mutate();
            if (dockEpochRef.current !== epoch) {
                return;
            }
            setLastRated({
                rating,
                dueAt: result.card.schedule.dueAt,
            });
            setReviewedWords((words) => [...words, targetWord]);
            setRevealedFor(null);
            // 评分按钮会随 revealed 卸载；把焦点交给下一张的「显示答案」，键盘流不断档。
            requestAnimationFrame(() => revealButtonRef.current?.focus());
        } catch (error) {
            if (dockEpochRef.current === epoch) {
                toast.error(error instanceof Error ? error.message : t('reviewDock.rateFailed'));
            }
        } finally {
            if (dockEpochRef.current === epoch) {
                setPending(false);
            }
        }
    };

    return (
        <>
            <Tooltip content={t('reviewDock.trigger')} placement="above">
                <button
                    type="button"
                    ref={popover.triggerRef}
                    onClick={() => (popover.isOpen ? popover.hide() : openDock())}
                    {...popover.triggerProps}
                    data-testid="review-dock-trigger"
                    aria-label={dueCount > 0
                        ? t('reviewDock.triggerWithDue', { count: dueCount })
                        : t('reviewDock.trigger')}
                    className={cn(
                        TOOLBAR_ICON_BUTTON,
                        'relative',
                        dueCount > 0 ? 'bg-primary/10 text-primary hover:bg-primary/15' : style.idle,
                    )}
                >
                    <BookOpenCheck className="h-4 w-4 stroke-[1.9]" />
                    {dueCount > 0 && (
                        <span
                            aria-hidden
                            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-background"
                        >
                            {dueCount > 99 ? '99+' : dueCount}
                        </span>
                    )}
                </button>
            </Tooltip>
            {popover.render(
                <div data-testid="review-dock-panel">
                <div className="flex items-start justify-between gap-3 px-1 pb-2 pt-1">
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{t('reviewDock.title')}</div>
                        <div className="mt-0.5 text-metadata leading-relaxed text-muted-foreground">
                            {t('reviewDock.subtitle')}
                        </div>
                    </div>
                    <div className="shrink-0 text-right">
                        <div className="text-xl font-semibold tabular-nums text-foreground">{dueCount}</div>
                        <div className="text-metadata text-muted-foreground">{t('reviewDock.dueWords')}</div>
                    </div>
                </div>

                {hasRetentionSample && data && (
                    <div className="flex items-center gap-1.5 px-1 pb-2">
                        <RetentionChip label={t('reviewDock.last7Days')} stats={data.stats.last7Days} />
                        <RetentionChip label={t('reviewDock.last30Days')} stats={data.stats.last30Days} />
                    </div>
                )}

                {error ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-error/30 bg-error/5 px-3 py-5 text-center">
                        <p className="text-sm text-error-text">{t('reviewDock.loadFailed')}</p>
                        <button
                            type="button"
                            onClick={() => { void mutate(); }}
                            className="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-2 text-sm text-foreground transition-colors hover:bg-muted/60 cursor-pointer"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('reviewDock.retry')}
                        </button>
                    </div>
                ) : isLoading && !data ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('reviewDock.loading')}
                    </div>
                ) : card ? (
                    <div className="px-1">
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-metadata text-muted-foreground">
                            <span data-testid="review-batch-progress">
                                {t('reviewDock.batchProgress', {
                                    done: batch.done + 1,
                                    total: batch.total,
                                    defaultValue: '第 {{done}} / {{total}} 张',
                                })}
                            </span>
                            <span className="font-mono tabular-nums">
                                {dueCount}
                                {' '}
                                {t('reviewDock.dueWords')}
                            </span>
                        </div>
                        <ReviewCardBody
                            card={card}
                            revealed={revealed}
                            pending={pending}
                            onReveal={() => setRevealedFor(card.word)}
                            onRate={(rating) => { void rate(rating); }}
                            revealRef={revealButtonRef}
                            clipCount={clipStats?.data?.[card.word.toLowerCase()]?.count ?? 0}
                            onOpenClips={(word) => {
                                popover.hide();
                                navigate(`/vocabulary?word=${encodeURIComponent(word)}`);
                            }}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-4 py-6 text-center">
                        <Check className="h-5 w-5 text-success-text" />
                        <p className="text-sm font-medium text-foreground" data-testid="review-batch-done">
                            {batch.done > 0
                                ? t('reviewDock.batchDone', {
                                    count: batch.done,
                                    defaultValue: '这一组已完成 {{count}} 张',
                                })
                                : t('reviewDock.emptyTitle')}
                        </p>
                        <p className="text-metadata leading-relaxed text-muted-foreground">
                            {batch.isComplete && dueCount > 0
                                ? t('reviewDock.batchMoreDue', {
                                    count: dueCount,
                                    defaultValue: '还有 {{count}} 个到期词',
                                })
                                : data?.nextDueAt
                                    ? t('reviewDock.nextDue', {
                                        when: formatLearningDue(data.nextDueAt, i18n.language, t),
                                    })
                                    : t('reviewDock.emptyHint')}
                        </p>
                        {batch.isComplete && dueCount > 0 && (
                            <button
                                type="button"
                                data-testid="review-batch-next"
                                onClick={() => setReviewedWords([])}
                                className="mt-1 flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-2 text-sm text-foreground transition-colors hover:bg-muted/60 cursor-pointer"
                            >
                                {t('reviewDock.batchNext', { defaultValue: '继续下一组' })}
                            </button>
                        )}
                    </div>
                )}

                {popover.isOpen && (
                    <div className="mt-2 flex justify-end px-1">
                        <button
                            type="button"
                            data-testid="review-dock-return"
                            onClick={returnToPlayback}
                            className="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-2 text-metadata text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground cursor-pointer"
                        >
                            <CornerUpLeft className="h-3 w-3" />
                            {t('reviewDock.returnToPlayback')}
                        </button>
                    </div>
                )}

                {lastRated && (
                    <div className="mt-2 flex items-center gap-1.5 px-1 text-metadata text-muted-foreground">
                        <Check className="h-3 w-3 text-success-text" />
                        <span>
                            {t('reviewDock.ratedWithNext', {
                                rating: t(`reviewDock.ratingShort.${lastRated.rating}`),
                                when: formatLearningDue(lastRated.dueAt, i18n.language, t),
                            })}
                        </span>
                    </div>
                )}
                </div>,
                { placement: 'above', alignment: 'end', offset: popoverOffset },
            )}
        </>
    );
}
