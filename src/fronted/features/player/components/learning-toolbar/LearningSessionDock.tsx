/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useState } from 'react';
import { Activity, ChevronRight, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { usePopover } from '@astryxdesign/core/Popover';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { CONTROL_POPOVER_PANEL } from '@/fronted/features/player/components/ControlPopover';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { useLearningSessionSince } from '@/fronted/features/player/learningSessionStore';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import type { LearningSessionWordVO } from '@/common/types/learningSession';
import {
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';
import { formatLearningClock, formatLearningDue } from './learningTime';
import LearningRecapDialog from './LearningRecapDialog';

/**
 * 单个统计数字。
 */
const SummaryStat = ({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: string;
}) => (
    <div className="rounded-lg border border-border/50 bg-background/50 px-2.5 py-2">
        <div className={cn('text-lg font-semibold tabular-nums', tone ?? 'text-foreground')}>
            {value}
        </div>
        <div className="text-metadata text-muted-foreground">{label}</div>
    </div>
);

/**
 * 最近遇见的目标词行。
 */
const SessionWordRow = ({
    word,
    locale,
    t,
}: {
    word: LearningSessionWordVO;
    locale: string;
    t: (key: string) => string;
}) => (
    <li className="flex items-center gap-2 py-1.5">
        <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{word.word}</div>
            <div className="truncate text-metadata text-muted-foreground">
                {word.translate?.trim() || t('reviewDock.noTranslation')}
            </div>
        </div>
        {word.dueAt ? (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-metadata font-medium text-primary">
                {t('learningSummary.dueBadge')}
            </span>
        ) : word.status === 'known' ? (
            <span className="shrink-0 rounded-md bg-success/10 px-1.5 py-0.5 text-metadata font-medium text-success-text">
                {t('learningSummary.masteredBadge')}
            </span>
        ) : (
            <span className="shrink-0 text-metadata tabular-nums text-muted-foreground">
                {formatLearningClock(word.lastSeenAt, locale)}
            </span>
        )}
    </li>
);

/**
 * 播放器内“本次学习”摘要。
 *
 * 只做轻量回顾：从本次播放开始累计遇到、掌握、到期与练习数据，
 * 不打断播放，也不重复复习坞的操作入口。
 */
export default function LearningSessionDock({
    tone,
    popoverOffset,
}: {
    tone: ToolbarTone;
    popoverOffset: number;
}) {
    const { t, i18n } = useTranslation('player');
    const { t: tRecap } = useTranslation('recap');
    const [recapOpen, setRecapOpen] = useState(false);
    const popover = usePopover({
        className: cn('w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden', CONTROL_POPOVER_PANEL),
        hasSurface: false,
        isModal: false,
        dialogLabel: t('learningSummary.title'),
    });
    const open = popover.isOpen;
    const videoId = usePlaybackSession((state) => state.videoId);
    const fileHash = usePlaybackSession((state) => state.srtHash);
    const { since } = useLearningSessionSince(videoId, fileHash);

    const summaryKey = open && since
        ? ['learning-data/session-summary', videoId, fileHash, since] as const
        : null;
    const { data, error, isLoading, mutate } = useSWR(
        summaryKey,
        async () => {
            if (!since) {
                throw new Error('missing learning session start');
            }
            return learningDataApi.getSessionSummary({
                videoId: videoId ?? undefined,
                fileHash: fileHash ?? undefined,
                since,
                limit: 8,
            });
        },
        {
            refreshInterval: 30_000,
            revalidateOnFocus: true,
            shouldRetryOnError: false,
        },
    );

    const style = TOOLBAR_TONE[tone];
    const startedAt = since ? formatLearningClock(since, i18n.language) : '';
    const hasWords = (data?.words.length ?? 0) > 0;

    return (
        <>
            <Tooltip content={t('learningSummary.trigger')} placement="above">
                <button
                    type="button"
                    ref={popover.triggerRef}
                    onClick={popover.toggle}
                    {...popover.triggerProps}
                    data-testid="learning-session-trigger"
                    aria-label={t('learningSummary.trigger')}
                    className={cn(TOOLBAR_ICON_BUTTON, style.idle)}
                >
                    <Activity className="h-4 w-4 stroke-[1.9]" />
                </button>
            </Tooltip>
            {popover.render(
                <div data-testid="learning-session-panel">
                <div className="flex items-start justify-between gap-3 px-1 pb-2 pt-1">
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                            {t('learningSummary.title')}
                        </div>
                        <div className="mt-0.5 text-metadata leading-relaxed text-muted-foreground">
                            {t('learningSummary.subtitle')}
                        </div>
                    </div>
                    {startedAt && (
                        <div className="shrink-0 text-right text-metadata text-muted-foreground">
                            {t('learningSummary.startedAt', { time: startedAt })}
                        </div>
                    )}
                </div>

                {error ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-error/30 bg-error/5 px-3 py-5 text-center">
                        <p className="text-sm text-error-text">{t('learningSummary.loadFailed')}</p>
                        <button
                            type="button"
                            onClick={() => { void mutate(); }}
                            className="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-2 text-sm text-foreground transition-colors hover:bg-muted/60 cursor-pointer"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('learningSummary.retry')}
                        </button>
                    </div>
                ) : isLoading && !data ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('learningSummary.loading')}
                    </div>
                ) : data ? (
                    <div className="space-y-2.5 px-1">
                        <div className="grid grid-cols-2 gap-1.5">
                            <SummaryStat
                                label={t('learningSummary.encountered')}
                                value={data.counts.encountered}
                            />
                            <SummaryStat
                                label={t('learningSummary.mastered')}
                                value={data.counts.mastered}
                                tone="text-success-text"
                            />
                            <SummaryStat
                                label={t('learningSummary.due')}
                                value={data.counts.due}
                                tone={data.counts.due > 0 ? 'text-primary' : undefined}
                            />
                            <SummaryStat
                                label={t('learningSummary.practice')}
                                value={data.counts.practice}
                            />
                        </div>

                        {hasWords ? (
                            <div className="rounded-xl border border-border/60 bg-card px-3 py-1.5">
                                <div className="pt-1.5 text-metadata font-semibold uppercase tracking-wider text-muted-foreground">
                                    {t('learningSummary.recentTitle')}
                                </div>
                                <ul className="divide-y divide-border/40">
                                    {data.words.map((word) => (
                                        <SessionWordRow
                                            key={word.word}
                                            word={word}
                                            locale={i18n.language}
                                            t={t}
                                        />
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-4 py-6 text-center">
                                <Sparkles className="h-5 w-5 text-muted-foreground" />
                                <p className="text-sm font-medium text-foreground">
                                    {t('learningSummary.emptyTitle')}
                                </p>
                                <p className="text-metadata leading-relaxed text-muted-foreground">
                                    {t('learningSummary.emptyHint')}
                                </p>
                            </div>
                        )}

                        {hasWords && since && (
                            <button
                                type="button"
                                data-testid="learning-recap-trigger"
                                title={tRecap('ctaHint')}
                                onClick={() => setRecapOpen(true)}
                                className="group flex w-full items-center gap-1.5 rounded-lg px-1 py-1.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <Sparkles className="h-3.5 w-3.5 shrink-0 text-warning-text/80" />
                                <span>{tRecap('cta')}</span>
                                <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                            </button>
                        )}

                        {data.counts.due === 0 && data.nextDueAt && (
                            <div className="px-1 pb-1 text-metadata text-muted-foreground">
                                {t('learningSummary.nextDue', {
                                    when: formatLearningDue(data.nextDueAt, i18n.language, t),
                                })}
                            </div>
                        )}
                    </div>
                ) : null}
                </div>,
                { placement: 'above', alignment: 'end', offset: popoverOffset },
            )}
            {since && (
                <LearningRecapDialog
                    open={recapOpen}
                    onOpenChange={setRecapOpen}
                    videoId={videoId ?? undefined}
                    fileHash={fileHash ?? undefined}
                    since={since}
                    locale={i18n.language.startsWith('en') ? 'en-US' : 'zh-CN'}
                />
            )}
        </>
    );
}
