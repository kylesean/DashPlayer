import { useState } from 'react';
import { Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/fronted/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/fronted/components/ui/popover';
import type { LearningMomentCandidate } from '@/common/learning/learningMoment';

export interface LearningMomentChipProps {
    candidate: LearningMomentCandidate;
    open: boolean;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onDismiss: () => void;
    onRate: (rating: 'again' | 'good') => void;
}

/**
 * 暂停时出现的到期词微回忆。
 *
 * 只占据主字幕下方原本的建议位，不遮挡正文；先让用户回忆，再揭示释义，
 * 最后用「想起来了 / 没想起来」完成一次极短复习。
 */
export default function LearningMomentChip({
    candidate,
    open,
    pending,
    onOpenChange,
    onDismiss,
    onRate,
}: LearningMomentChipProps) {
    const { t } = useTranslation('moment');
    const [revealed, setRevealed] = useState(false);

    const handleOpenChange = (next: boolean): void => {
        if (!next) {
            setRevealed(false);
        }
        onOpenChange(next);
    };

    const statusLabel = candidate.status === 'familiar'
        ? t('statusFamiliar')
        : t('statusLearning');

    return (
        <div
            data-testid="learning-moment-slot"
            className="flex h-7 w-full items-center justify-center"
        >
            <Popover open={open} onOpenChange={handleOpenChange}>
                <div
                    className={cn(
                        'inline-flex h-6 max-w-full items-center rounded-full border border-primary/30 bg-primary/5',
                        'pl-2 pr-1 text-metadata text-muted-foreground',
                    )}
                >
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            data-testid="learning-moment"
                            className="inline-flex min-w-0 items-center gap-1.5 pr-1.5 cursor-pointer transition-colors hover:text-foreground"
                        >
                            <Brain className="h-3 w-3 shrink-0 text-primary" />
                            <span className="shrink-0 font-medium text-foreground">
                                {candidate.surface}
                            </span>
                            <span className="max-w-[18rem] truncate">
                                {t('prompt')}
                            </span>
                        </button>
                    </PopoverTrigger>
                    <button
                        type="button"
                        aria-label={t('dismiss')}
                        title={t('dismiss')}
                        onClick={onDismiss}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground cursor-pointer"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
                <PopoverContent
                    side="top"
                    align="center"
                    sideOffset={6}
                    className="w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-border/60 bg-popover p-3 shadow-lg"
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-metadata font-semibold uppercase tracking-wider text-primary">
                            {t('title')}
                        </span>
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-metadata font-medium text-primary">
                            {statusLabel}
                        </span>
                    </div>

                    <div className="flex min-h-24 flex-col items-center justify-center py-3 text-center">
                        <div className="flex items-baseline gap-2">
                            <span className="max-w-full break-words text-2xl font-semibold tracking-tight text-foreground">
                                {candidate.surface}
                            </span>
                            {candidate.phonetic && (
                                <span className="text-metadata text-muted-foreground">
                                    {candidate.phonetic}
                                </span>
                            )}
                        </div>
                        {revealed ? (
                            <p className="mt-2 max-w-full break-words text-sm leading-relaxed text-foreground">
                                {candidate.meaning}
                            </p>
                        ) : (
                            <p className="mt-2 text-sm text-muted-foreground">
                                {t('recallHint')}
                            </p>
                        )}
                    </div>

                    {revealed ? (
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                data-testid="learning-moment-forgotten"
                                disabled={pending}
                                onClick={() => onRate('again')}
                                className={cn(
                                    'h-8 rounded-lg border text-sm font-medium transition-colors cursor-pointer',
                                    'border-warning/30 bg-warning/5 text-warning-text hover:bg-warning/10',
                                    'disabled:cursor-wait disabled:opacity-60',
                                )}
                            >
                                {t('forgotten')}
                            </button>
                            <button
                                type="button"
                                data-testid="learning-moment-remembered"
                                disabled={pending}
                                onClick={() => onRate('good')}
                                className={cn(
                                    'h-8 rounded-lg border text-sm font-medium transition-colors cursor-pointer',
                                    'border-success/30 bg-success/5 text-success-text hover:bg-success/10',
                                    'disabled:cursor-wait disabled:opacity-60',
                                )}
                            >
                                {t('remembered')}
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            data-testid="learning-moment-reveal"
                            onClick={() => setRevealed(true)}
                            className="h-8 w-full rounded-lg border border-border/70 bg-background/60 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 cursor-pointer"
                        >
                            {t('reveal')}
                        </button>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}
