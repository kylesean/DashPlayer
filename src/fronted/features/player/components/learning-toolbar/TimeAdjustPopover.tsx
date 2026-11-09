import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/fronted/components/ui/popover';
import { Input } from '@/fronted/components/ui/input';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import {
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';

/**
 * 当前句时间微调：一个按钮 + 一个弹层。
 *
 * 字幕与画面不同步时，学习者只需要动“这一句”的起止；调整量按句持久化，
 * 不改变字幕文件本身。清除动作在设置弹层里，这里只负责调。
 *
 * @param tone 宿主底色。
 * @param popoverOffset 弹层底边到按钮顶边的间距。
 */
export default function TimeAdjustPopover({
    tone,
    popoverOffset,
}: {
    tone: ToolbarTone;
    popoverOffset: number;
}) {
    const { t } = useI18nTranslation('player');
    const sentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjusted = Boolean(sentence && srtTender && srtTender.adjusted(sentence));
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<{ start: string; end: string }>({ start: '0', end: '0' });

    const handleOpenChange = (next: boolean) => {
        if (next) {
            const diff = srtTender && sentence && adjusted ? srtTender.timeDiff(sentence) : { start: 0, end: 0 };
            setDraft({ start: diff.start.toFixed(2), end: diff.end.toFixed(2) });
        }
        setOpen(next);
    };

    /** 把草稿里的绝对偏移换算成增量，走增量调整动作（保留虚拟组归属与重播语义）。 */
    const applyDraft = (field: 'start' | 'end', raw: string) => {
        const next = Number(raw);
        if (!Number.isFinite(next)) return;
        const { srtTender: tender, currentSentence } = usePlayer.getState();
        const current = tender && currentSentence && tender.adjusted(currentSentence)
            ? tender.timeDiff(currentSentence)[field]
            : 0;
        const delta = next - current;
        if (Math.abs(delta) < 0.005) return;
        if (field === 'start') {
            playerActions.adjustCurrentBegin(delta);
        } else {
            playerActions.adjustCurrentEnd(delta);
        }
    };

    const diff = srtTender && sentence && adjusted ? srtTender.timeDiff(sentence) : { start: 0, end: 0 };
    const style = TOOLBAR_TONE[tone];

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <Tooltip content={t('subtitle.adjustTooltip')} placement="above">
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={t('subtitle.adjustTitle')}
                        className={cn(
                            TOOLBAR_ICON_BUTTON,
                            adjusted ? style.accent.amber : style.idle
                        )}
                    >
                        <History className="w-3.5 h-3.5 stroke-[2]" />
                    </button>
                </PopoverTrigger>
            </Tooltip>
            <PopoverContent side="top" align="end" sideOffset={popoverOffset} className="w-72 p-3.5 gap-3 shadow-xl border-border/80 bg-popover/95 backdrop-blur-md">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <History className="w-3.5 h-3.5 text-amber-500" />
                        <span>{t('subtitle.adjustTitle')}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            if (adjusted) {
                                void playerActions.clearAdjust();
                                setDraft({ start: '0.00', end: '0.00' });
                            }
                        }}
                        disabled={!adjusted}
                        className={cn(
                            'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors',
                            adjusted
                                ? 'font-medium text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-950/60 cursor-pointer'
                                : 'text-muted-foreground/40 cursor-default'
                        )}
                    >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t('subtitle.reset')}</span>
                    </button>
                </div>

                <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">{t('subtitle.beginLabel')}</span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                            {`${diff.start >= 0 ? '+' : ''}${diff.start.toFixed(2)}s`}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => playerActions.adjustCurrentBegin(-0.2)}
                            className="flex h-7 flex-1 items-center justify-center rounded-md border border-border/60 bg-muted/40 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
                        >
                            -0.2s
                        </button>
                        <button
                            type="button"
                            onClick={() => playerActions.adjustCurrentBegin(0.2)}
                            className="flex h-7 flex-1 items-center justify-center rounded-md border border-border/60 bg-muted/40 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
                        >
                            +0.2s
                        </button>
                        <div className="flex w-20 shrink-0 items-center gap-1">
                            <Input
                                type="number"
                                step={0.05}
                                className="h-7 px-1.5 text-center font-mono text-[11px]"
                                value={draft.start}
                                onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                                onBlur={() => applyDraft('start', draft.start)}
                                onKeyDown={(e) => { if (e.key === 'Enter') applyDraft('start', draft.start); }}
                            />
                            <span className="text-[10px] text-muted-foreground">s</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">{t('subtitle.endLabel')}</span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                            {`${diff.end >= 0 ? '+' : ''}${diff.end.toFixed(2)}s`}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => playerActions.adjustCurrentEnd(-0.2)}
                            className="flex h-7 flex-1 items-center justify-center rounded-md border border-border/60 bg-muted/40 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
                        >
                            -0.2s
                        </button>
                        <button
                            type="button"
                            onClick={() => playerActions.adjustCurrentEnd(0.2)}
                            className="flex h-7 flex-1 items-center justify-center rounded-md border border-border/60 bg-muted/40 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
                        >
                            +0.2s
                        </button>
                        <div className="flex w-20 shrink-0 items-center gap-1">
                            <Input
                                type="number"
                                step={0.05}
                                className="h-7 px-1.5 text-center font-mono text-[11px]"
                                value={draft.end}
                                onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                                onBlur={() => applyDraft('end', draft.end)}
                                onKeyDown={(e) => { if (e.key === 'Enter') applyDraft('end', draft.end); }}
                            />
                            <span className="text-[10px] text-muted-foreground">s</span>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
