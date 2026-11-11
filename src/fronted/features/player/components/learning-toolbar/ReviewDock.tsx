import { useState } from 'react';
import { BookOpenCheck, Check, Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useSWR from 'swr';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/fronted/components/ui/popover';
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

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * 格式化下一次复习时间；近一天内用相对时间，更远用日期。
 *
 * @param iso 到期时间。
 * @param locale 当前界面语言。
 * @param t 翻译函数。
 * @returns 简短时间描述。
 */
const formatDue = (
    iso: string,
    locale: string,
    t: (key: string, options?: Record<string, unknown>) => string,
): string => {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return t('reviewDock.dueUnknown');
    const diff = time - Date.now();
    if (diff <= 0) return t('reviewDock.dueNow');
    if (diff < 60 * 60 * 1000) {
        return t('reviewDock.dueInMinutes', { count: Math.max(1, Math.round(diff / 60000)) });
    }
    if (diff < DAY_MS) {
        return t('reviewDock.dueInHours', { count: Math.max(1, Math.round(diff / (60 * 60 * 1000))) });
    }
    const days = Math.round(diff / DAY_MS);
    if (days <= 30) {
        return t('reviewDock.dueInDays', { count: days });
    }
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(time));
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
}: {
    card: ReviewCardVO;
    revealed: boolean;
    pending: boolean;
    onReveal: () => void;
    onRate: (rating: ReviewRating) => void;
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
                    data-testid="review-reveal"
                    onClick={onReveal}
                    className="h-8 w-full rounded-lg border border-border/70 bg-background/60 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 cursor-pointer"
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
    const [open, setOpen] = useState(false);
    const [revealedFor, setRevealedFor] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [lastRated, setLastRated] = useState<{
        rating: ReviewRating;
        dueAt: string;
    } | null>(null);

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
    const dueCount = data?.dueCount ?? 0;
    const card = data?.items[0] ?? null;
    const revealed = card !== null && revealedFor === card.word;
    const hasRetentionSample = (data?.stats.last7Days.reviewed ?? 0) > 0
        || (data?.stats.last30Days.reviewed ?? 0) > 0;

    const rate = async (rating: ReviewRating) => {
        if (!card || pending) return;
        setPending(true);
        try {
            const result = await videoLearningApi.rateReview(card.word, rating);
            setLastRated({
                rating,
                dueAt: result.card.schedule.dueAt,
            });
            setRevealedFor(null);
            await mutate();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('reviewDock.rateFailed'));
        } finally {
            setPending(false);
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                    setRevealedFor(null);
                    setLastRated(null);
                }
            }}
        >
            <Tooltip content={t('reviewDock.trigger')} placement="above">
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        data-testid="review-dock-trigger"
                        aria-label={t('reviewDock.trigger')}
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
                                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                            >
                                {dueCount > 99 ? '99+' : dueCount}
                            </span>
                        )}
                    </button>
                </PopoverTrigger>
            </Tooltip>
            <PopoverContent
                side="top"
                align="end"
                sideOffset={popoverOffset}
                className={cn('w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden', CONTROL_POPOVER_PANEL)}
                data-testid="review-dock-panel"
            >
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
                        <ReviewCardBody
                            card={card}
                            revealed={revealed}
                            pending={pending}
                            onReveal={() => setRevealedFor(card.word)}
                            onRate={(rating) => { void rate(rating); }}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-4 py-6 text-center">
                        <Check className="h-5 w-5 text-success-text" />
                        <p className="text-sm font-medium text-foreground">{t('reviewDock.emptyTitle')}</p>
                        <p className="text-metadata leading-relaxed text-muted-foreground">
                            {data?.nextDueAt
                                ? t('reviewDock.nextDue', {
                                    when: formatDue(data.nextDueAt, i18n.language, t),
                                })
                                : t('reviewDock.emptyHint')}
                        </p>
                    </div>
                )}

                {lastRated && (
                    <div className="mt-2 flex items-center gap-1.5 px-1 text-metadata text-muted-foreground">
                        <Check className="h-3 w-3 text-success-text" />
                        <span>
                            {t('reviewDock.ratedWithNext', {
                                rating: t(`reviewDock.ratingShort.${lastRated.rating}`),
                                when: formatDue(lastRated.dueAt, i18n.language, t),
                            })}
                        </span>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
