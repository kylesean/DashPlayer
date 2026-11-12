/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useCallback, useEffect, useState } from 'react';
import { Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePopover } from '@astryxdesign/core/Popover';
import { Button } from '@astryxdesign/core/Button';

import { cn } from '@/fronted/lib/utils';
import type { LearningMomentCandidate } from '@/common/learning/learningMoment';

export interface LearningMomentChipProps {
    candidate: LearningMomentCandidate;
    open: boolean;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onDismiss: () => void;
    onRate: (rating: 'again' | 'good') => void;
    /**
     * 用这句话做一次跟读任务。
     *
     * 只在「强化」强度下由父级传入：此时用户明确处于专门学习时段，
     * 才值得从一次微回忆再推进一步到口语产出。`coach` 下不传，保持安静。
     */
    onStartShadowing?: () => void;
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
    onStartShadowing,
}: LearningMomentChipProps) {
    const { t } = useTranslation('moment');
    const [revealed, setRevealed] = useState(false);

    const handlePopoverShow = useCallback(() => {
        onOpenChange(true);
    }, [onOpenChange]);
    const handlePopoverHide = useCallback(() => {
        setRevealed(false);
        onOpenChange(false);
    }, [onOpenChange]);
    const popover = usePopover({
        className: 'w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border/60 bg-popover p-3 shadow-lg',
        hasSurface: false,
        isModal: false,
        dialogLabel: t('title'),
        onShow: handlePopoverShow,
        onHide: handlePopoverHide,
    });

    // open 由父级驱动（暂停时自动展开），与浮层手势关闭双向同步。
    useEffect(() => {
        if (open && !popover.isOpen) {
            popover.show();
        } else if (!open && popover.isOpen) {
            popover.hide();
        }
    }, [open, popover]);

    const statusLabel = candidate.status === 'familiar'
        ? t('statusFamiliar')
        : t('statusLearning');

    return (
        <div
            data-testid="learning-moment-slot"
            className="flex h-7 w-full items-center justify-center"
        >
            <div
                className={cn(
                    'inline-flex h-6 max-w-full items-center rounded-full border border-primary/30 bg-primary/5',
                    'pl-2 pr-1 text-metadata text-muted-foreground',
                )}
            >
                <button
                    type="button"
                    ref={popover.triggerRef}
                    onClick={popover.toggle}
                    {...popover.triggerProps}
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
            {popover.render(
                <>
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
                        <div className="space-y-1.5">
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
                            {onStartShadowing && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    label={t('shadowing')}
                                    data-testid="learning-moment-shadowing"
                                    onClick={onStartShadowing}
                                />
                            )}
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
                </>,
                { placement: 'above', alignment: 'center', offset: 6 },
            )}
        </div>
    );
}
