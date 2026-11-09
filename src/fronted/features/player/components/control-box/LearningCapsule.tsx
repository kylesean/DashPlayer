import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    CirclePause,
    Eraser,
    History,
    Repeat1,
    RotateCcw,
    SlidersHorizontal,
    Sparkles,
    SquareDashedBottom,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/fronted/components/ui/popover';
import { Input } from '@/fronted/components/ui/input';
import { cn } from '@/fronted/lib/utils';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import PracticeModeButton from '@/fronted/features/player/components/srt-layout/PracticeModeButton';
import LearningModeButton from '@/fronted/features/player/components/srt-layout/LearningModeButton';
import {
    CONTROL_POPOVER_ICON,
    CONTROL_POPOVER_LABEL,
    CONTROL_POPOVER_PANEL,
    CONTROL_POPOVER_SEPARATOR,
    ControlPopoverRow,
} from '@/fronted/features/player/components/ControlPopover';

/**
 * 自适应沉浸式学习胶囊（Learning Capsule）。
 * 
 * 悬浮在主字幕区域的右下角，高度聚合语言学习者核心动作：
 * 1. 轨道快速切换（EN / 中 / 双语）
 * 2. 精听核心开关（单句循环 / 句末自动暂停）
 * 3. 伴随练习（跟读练习 / 整句 AI 学习）
 * 4. 偏好与时间微调 Popover
 */
export default function LearningCapsule({ className }: { className?: string }) {
    const { t } = useI18nTranslation('player');

    // 字幕轨道状态
    const {
        showEn,
        showCn,
        showSourceZh,
        changeShowEn,
        changeShowCn,
        changeShowSourceZh,
        hardsubMaskOn,
        toggleHardsubMask,
    } = usePlayerUi(
        useShallow((s) => ({
            showEn: s.showEn,
            showCn: s.showCn,
            showSourceZh: s.showSourceZh,
            changeShowEn: s.changeShowEn,
            changeShowCn: s.changeShowCn,
            changeShowSourceZh: s.changeShowSourceZh,
            hardsubMaskOn: s.hardsubMaskOn,
            toggleHardsubMask: s.toggleHardsubMask,
        }))
    );

    // 精听模式状态
    const singleRepeat = usePlayer((s) => s.singleRepeat);
    const autoPause = usePlayer((s) => s.autoPause);
    const autoPlayNext = usePlayer((s) => s.autoPlayNext);

    // 设置与快捷键
    const pauseOnWordHover = useSetting((s) => s.values.get('player.pauseOnWordHover')) === 'true';
    const setSetting = useSetting((s) => s.setSetting);
    const repeatShortcut = useSetting((s) => s.setting('shortcut.repeatSentence'));
    const autoPauseShortcut = useSetting((s) => s.setting('shortcut.autoPause'));

    // 时间微调状态
    const sentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjusted = Boolean(sentence && srtTender && srtTender.adjusted(sentence));
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [adjustOpen, setAdjustOpen] = useState(false);
    const [adjustDraft, setAdjustDraft] = useState<{ start: string; end: string }>({ start: '0', end: '0' });

    const isBilingual = showEn && (showCn || showSourceZh);
    const isEnOnly = showEn && !showCn && !showSourceZh;
    const isCnOnly = !showEn && (showCn || showSourceZh);

    const handleAdjustOpenChange = (open: boolean) => {
        if (open) {
            const diff = srtTender && sentence && adjusted ? srtTender.timeDiff(sentence) : { start: 0, end: 0 };
            setAdjustDraft({ start: diff.start.toFixed(2), end: diff.end.toFixed(2) });
        }
        setAdjustOpen(open);
    };

    const applyAdjustDraft = (field: 'start' | 'end', raw: string) => {
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

    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 p-1 rounded-full',
                'bg-background/90 dark:bg-neutral-900/90 backdrop-blur-md',
                'border border-border/70 shadow-lg text-foreground select-none',
                'transition-all duration-200 hover:shadow-xl hover:border-border',
                className
            )}
            onMouseEnter={() => playerActions.setHoverRepeat(true)}
            onMouseLeave={() => playerActions.setHoverRepeat(false)}
        >
            {/* 1. 字幕轨道快速切换药丸 */}
            <div className="flex items-center p-0.5 rounded-full bg-muted/60 border border-border/40 text-[11px] font-medium shrink-0">
                <button
                    type="button"
                    onClick={() => {
                        if (!showEn) changeShowEn();
                        if (showCn) changeShowCn();
                        if (showSourceZh) changeShowSourceZh();
                    }}
                    title={t('controlBar.tracksTooltipEnglish')}
                    className={cn(
                        'px-2 py-0.5 rounded-full transition-all cursor-pointer',
                        isEnOnly
                            ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    EN
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (showEn) changeShowEn();
                        if (!showCn && !showSourceZh) changeShowCn();
                    }}
                    title={t('controlBar.tracksTooltipChinese')}
                    className={cn(
                        'px-2 py-0.5 rounded-full transition-all cursor-pointer',
                        isCnOnly
                            ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    中
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (!showEn) changeShowEn();
                        if (!showCn) changeShowCn();
                    }}
                    title={t('controlBar.tracksTooltipBilingual')}
                    className={cn(
                        'px-2 py-0.5 rounded-full transition-all cursor-pointer',
                        isBilingual
                            ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    {t('controlBar.tracksBilingual')}
                </button>
            </div>

            <div className="w-px h-3.5 bg-border/60 shrink-0 mx-0.5" />

            {/* 2. 精听核心开关：单句循环 */}
            <Tooltip
                content={`${t('controlBar.modeSingleRepeat')}${repeatShortcut ? ` (${repeatShortcut})` : ''}`}
                placement="above"
            >
                <button
                    type="button"
                    onClick={() => playerActions.setSingleRepeat(!singleRepeat)}
                    className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0',
                        singleRepeat
                            ? 'bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/40 shadow-xs'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                    )}
                    aria-pressed={singleRepeat}
                    aria-label={t('controlBar.modeSingleRepeat')}
                >
                    <Repeat1 className="w-3.5 h-3.5 stroke-[2.2]" />
                </button>
            </Tooltip>

            {/* 3. 精听核心开关：自动暂停 */}
            <Tooltip
                content={`${t('controlBar.modeAutoPause')}${autoPauseShortcut ? ` (${autoPauseShortcut})` : ''}`}
                placement="above"
            >
                <button
                    type="button"
                    onClick={() => playerActions.setAutoPause(!autoPause)}
                    className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0',
                        autoPause
                            ? 'bg-emerald-500/20 text-emerald-500 ring-1 ring-emerald-500/40 shadow-xs'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                    )}
                    aria-pressed={autoPause}
                    aria-label={t('controlBar.modeAutoPause')}
                >
                    <CirclePause className="w-3.5 h-3.5 stroke-[2.2]" />
                </button>
            </Tooltip>

            <div className="w-px h-3.5 bg-border/60 shrink-0 mx-0.5" />

            {/* 4. 跟读练习按钮 */}
            <PracticeModeButton />

            {/* 5. 整句 AI 学习按钮 */}
            <LearningModeButton />

            {/* 6. 时间微调弹层 */}
            <Popover open={adjustOpen} onOpenChange={handleAdjustOpenChange}>
                <Tooltip content={t('subtitle.adjustTooltip')} placement="above">
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                'w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0',
                                adjusted
                                    ? 'bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/40'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                            )}
                            aria-label={t('subtitle.adjustTitle')}
                        >
                            <History className="w-3.5 h-3.5 stroke-[2]" />
                        </button>
                    </PopoverTrigger>
                </Tooltip>
                <PopoverContent side="top" align="end" className="w-72 p-3.5 gap-3 shadow-xl border-border/80 bg-popover/95 backdrop-blur-md">
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
                                    setAdjustDraft({ start: '0.00', end: '0.00' });
                                }
                            }}
                            disabled={!adjusted}
                            className={cn(
                                'flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors',
                                adjusted
                                    ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60 font-medium cursor-pointer'
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
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => playerActions.adjustCurrentBegin(-0.2)}
                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                            >
                                -0.2s
                            </button>
                            <button
                                type="button"
                                onClick={() => playerActions.adjustCurrentBegin(0.2)}
                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                            >
                                +0.2s
                            </button>
                            <div className="flex items-center gap-1 w-20 shrink-0">
                                <Input
                                    type="number"
                                    step={0.05}
                                    className="h-7 text-[11px] font-mono px-1.5 text-center"
                                    value={adjustDraft.start}
                                    onChange={(e) => setAdjustDraft((d) => ({ ...d, start: e.target.value }))}
                                    onBlur={() => applyAdjustDraft('start', adjustDraft.start)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') applyAdjustDraft('start', adjustDraft.start); }}
                                />
                                <span className="text-[10px] text-muted-foreground">s</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-1">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground font-medium">{t('subtitle.endLabel')}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => playerActions.adjustCurrentEnd(-0.2)}
                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                            >
                                -0.2s
                            </button>
                            <button
                                type="button"
                                onClick={() => playerActions.adjustCurrentEnd(0.2)}
                                className="flex-1 h-7 rounded-md border border-border/60 bg-muted/40 hover:bg-muted text-[11px] font-mono font-medium text-foreground transition-colors flex items-center justify-center active:scale-95"
                            >
                                +0.2s
                            </button>
                            <div className="flex items-center gap-1 w-20 shrink-0">
                                <Input
                                    type="number"
                                    step={0.05}
                                    className="h-7 text-[11px] font-mono px-1.5 text-center"
                                    value={adjustDraft.end}
                                    onChange={(e) => setAdjustDraft((d) => ({ ...d, end: e.target.value }))}
                                    onBlur={() => applyAdjustDraft('end', adjustDraft.end)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') applyAdjustDraft('end', adjustDraft.end); }}
                                />
                                <span className="text-[10px] text-muted-foreground">s</span>
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {/* 7. 更多学习与播放偏好 Popover */}
            <Popover open={preferencesOpen} onOpenChange={setPreferencesOpen}>
                <Tooltip content={t('controlBox.title')} placement="above">
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/70 shrink-0"
                            aria-label={t('controlBox.title')}
                        >
                            <SlidersHorizontal className="w-3.5 h-3.5 stroke-[2]" />
                        </button>
                    </PopoverTrigger>
                </Tooltip>
                <PopoverContent
                    side="top"
                    align="end"
                    className={cn('w-64', CONTROL_POPOVER_PANEL)}
                >
                    <div className={CONTROL_POPOVER_LABEL}>
                        {t('controlBox.description', { defaultValue: '学习偏好与辅助' })}
                    </div>
                    <div className={CONTROL_POPOVER_SEPARATOR} />
                    <ControlPopoverRow
                        checked={pauseOnWordHover}
                        label={t('controlBox.pauseOnWordHover')}
                        title={t('controlBox.pauseOnWordHoverHint')}
                        onActivate={async () => {
                            const next = !pauseOnWordHover;
                            await setSetting('player.pauseOnWordHover', next ? 'true' : 'false');
                        }}
                    />
                    <ControlPopoverRow
                        checked={autoPlayNext}
                        label={t('controlBox.autoPlayNext')}
                        title={t('controlBox.autoPlayNextHint')}
                        onActivate={async () => {
                            const next = !autoPlayNext;
                            playerActions.setAutoPlayNext(next);
                            await setSetting('player.autoPlayNext', next ? 'true' : 'false');
                        }}
                    />
                    <ControlPopoverRow
                        checked={hardsubMaskOn}
                        icon={<SquareDashedBottom className={CONTROL_POPOVER_ICON} />}
                        label={t('hardsubMask.label')}
                        onActivate={toggleHardsubMask}
                    />
                    <div className={CONTROL_POPOVER_SEPARATOR} />
                    <ControlPopoverRow
                        icon={<Eraser className={CONTROL_POPOVER_ICON} />}
                        label={t('clearAdjust.button')}
                        title={t('clearAdjust.tooltipSubtitle')}
                        onActivate={async () => {
                            const fileHash = usePlaybackSession.getState().srtHash;
                            if (!fileHash) return;
                            await playerApi.deleteTimestampAdjustment(fileHash);
                            usePlaybackSession.getState().reloadSubtitles();
                            toast(t('clearAdjust.done'), { icon: '👏' });
                        }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
}
