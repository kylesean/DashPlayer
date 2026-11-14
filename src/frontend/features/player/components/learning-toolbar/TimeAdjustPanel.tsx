import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';

import { cn } from '@/frontend/lib/utils';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import { usePlayer } from '@/frontend/features/player/playerStore';
import { usePlayerState } from '@/frontend/features/player/playerState';

/**
 * 当前句时间微调面板（不含弹层外壳）。
 *
 * 字幕与画面不同步时，学习者只需要动“这一句”的起止；调整量按句持久化，
 * 不改变字幕文件本身。外壳由调用方决定：设置弹层里以二级弹层打开。
 */
export default function TimeAdjustPanel() {
    const { t } = useI18nTranslation('player');
    const sentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjusted = Boolean(sentence && srtTender && srtTender.adjusted(sentence));
    const diff = srtTender && sentence && adjusted ? srtTender.timeDiff(sentence) : { start: 0, end: 0 };
    const snapshotKey = `${sentence?.fileHash ?? 'none'}:${sentence?.index ?? -1}:${diff.start.toFixed(2)}:${diff.end.toFixed(2)}`;
    const [draftState, setDraftState] = useState<{
        key: string;
        start: string;
        end: string;
    } | null>(null);
    const draft = draftState && draftState.key === snapshotKey
        ? { start: draftState.start, end: draftState.end }
        : { start: diff.start.toFixed(2), end: diff.end.toFixed(2) };

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

    const stepButtons = (field: 'start' | 'end') => (
        <div className="flex items-center gap-1.5">
            <button
                type="button"
                onClick={() => (field === 'start'
                    ? playerActions.adjustCurrentBegin(-0.2)
                    : playerActions.adjustCurrentEnd(-0.2))}
                className="flex h-7 flex-1 items-center justify-center rounded-md border border-border/60 bg-muted/40 font-mono text-sm font-medium text-primary transition-colors hover:bg-muted active:scale-95"
            >
                -0.2s
            </button>
            <button
                type="button"
                onClick={() => (field === 'start'
                    ? playerActions.adjustCurrentBegin(0.2)
                    : playerActions.adjustCurrentEnd(0.2))}
                className="flex h-7 flex-1 items-center justify-center rounded-md border border-border/60 bg-muted/40 font-mono text-sm font-medium text-primary transition-colors hover:bg-muted active:scale-95"
            >
                +0.2s
            </button>
            {/* NumberInput 默认用 --text-body-size（= --font-size-base），比同排按钮的
                text-sm 大一档。这里把它压到 supporting，与两侧步进按钮同字号。 */}
            <div className="w-24 shrink-0 [--text-body-size:var(--text-supporting-size)] [--text-body-leading:var(--text-supporting-leading)]">
                <NumberInput
                    label={field === 'start' ? t('subtitle.beginLabel') : t('subtitle.endLabel')}
                    isLabelHidden
                    size="sm"
                    width="100%"
                    step={0.05}
                    units="s"
                    value={Number.parseFloat(draft[field]) || 0}
                    onChange={(val) => {
                        setDraftState({
                            key: snapshotKey,
                            ...draft,
                            [field]: val.toFixed(2),
                        });
                        applyDraft(field, String(val));
                    }}
                />
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <History className="w-3.5 h-3.5 text-warning-text" />
                    <span>{t('subtitle.adjustTitle')}</span>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        if (adjusted) {
                            void playerActions.clearAdjust();
                            setDraftState(null);
                        }
                    }}
                    disabled={!adjusted}
                    className={cn(
                        'flex items-center gap-1 rounded-md px-2 py-0.5 text-metadata transition-colors',
                        adjusted
                            ? 'font-medium text-warning-text hover:bg-warning-muted cursor-pointer'
                            : 'text-secondary/40 cursor-default'
                    )}
                >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t('subtitle.reset')}</span>
                </button>
            </div>

            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary font-medium">{t('subtitle.beginLabel')}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-primary">
                        {`${diff.start >= 0 ? '+' : ''}${diff.start.toFixed(2)}s`}
                    </span>
                </div>
                {stepButtons('start')}
            </div>

            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary font-medium">{t('subtitle.endLabel')}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-primary">
                        {`${diff.end >= 0 ? '+' : ''}${diff.end.toFixed(2)}s`}
                    </span>
                </div>
                {stepButtons('end')}
            </div>
        </div>
    );
}
