/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useEffect, useState } from 'react';
import {
    ChevronRight,
    CirclePause,
    Gauge,
    Headphones,
    Play,
    Repeat,
    Repeat1,
    SlidersHorizontal,
} from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { usePopover } from '@astryxdesign/core/Popover';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Divider } from '@astryxdesign/core/Divider';
import { Kbd } from '@astryxdesign/core/Kbd';
import { VStack } from '@astryxdesign/core/VStack';
import { RadioIndicator } from '@astryxdesign/core/Indicator';

import { cn } from '@/fronted/lib/utils';
import { CONTROL_POPOVER_PANEL } from '@/fronted/features/player/components/ControlPopover';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { useTrainingModeStore } from '@/fronted/features/player/trainingStore';
import { TrainingSettingsDialog } from '@/fronted/features/player/components/TrainingSettingsDialog';
import useSetting from '@/fronted/features/settings/settingsStore';
import { formatShortcut } from '@/fronted/features/player/components/formatShortcut';
import { deriveSentenceEndMode } from '@/fronted/features/player/lib/sentence-end-mode';
import { PopoverSwitchRow } from './PopoverSwitchRow';
import {
    TOOLBAR_BADGE,
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TEXT_BUTTON,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';

/** 提取用于 Kbd 展示的主快捷键字符。 */
function primaryShortcutKey(shortcut?: string): string | null {
    if (!shortcut) return null;
    const first = shortcut.split(',')[0]?.trim();
    return first ? first.toLowerCase() : null;
}

/** 格式化递进倍速链表（如 [0.75, 1, 1.25] -> "0.75→1→1.25x"）。 */
function formatRateChain(rates: number[]): string {
    if (rates.length === 0) return '';
    if (rates.length === 1) return `${rates[0]}x`;
    return `${rates.join('→')}x`;
}

/** 参数胶囊标签：与带立体边框的键盘键帽 Kbd 区分，清晰表达“设定参数”。 */
function ParamBadge({ label, active }: { label: string; active: boolean }) {
    return (
        <span
            className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-metadata leading-none transition-colors',
                active
                    ? 'bg-success/15 text-success-text'
                    : 'bg-muted/70 text-muted-foreground'
            )}
        >
            {label}
        </span>
    );
}

/**
 * 训练模式单选项：统一左圆圈 + 图标 + 纯动作名称，右侧参数胶囊/键帽对齐。
 */
interface ModeOptionRowProps {
    isActive: boolean;
    icon: React.ReactNode;
    label: string;
    rightContent?: React.ReactNode;
    title?: string;
    onSelect: () => void;
    testId?: string;
}

function ModeOptionRow({
    isActive,
    icon,
    label,
    rightContent,
    title,
    onSelect,
    testId,
}: ModeOptionRowProps) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            title={title}
            onClick={onSelect}
            data-testid={testId}
            className={cn(
                'group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors cursor-pointer select-none outline-none text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current',
                isActive
                    ? 'bg-success/10 text-success-text font-medium'
                    : 'text-secondary hover:bg-muted/40 hover:text-foreground'
            )}
        >
            <div className="flex items-center gap-2 min-w-0">
                <RadioIndicator state={isActive ? 'checked' : 'unchecked'} size="sm" />
                <span className={cn('w-4 h-4 shrink-0 transition-colors', isActive ? 'text-success-text' : 'text-secondary group-hover:text-foreground')}>
                    {icon}
                </span>
                <span className="truncate">{label}</span>
            </div>
            {rightContent}
        </button>
    );
}

/**
 * 训练模式入口：一个按钮 + 一个现代化 Astryx 训练面板。
 *
 * 遵循现代组件库规范：
 * 1. 结构分为三层：模式选择（互斥单选）、辅助播放偏好（独立 Switch 开关）、参数弹窗入口；
 * 2. 彻底清除旧菜单左侧莫名缩进 14px 空白与无法判断开闭状态的缺陷；
 * 3. 尺寸对齐 340px，与播放设置浮层保持完全一致的视觉秩序与呼吸感。
 *
 * @param tone 宿主底色：字幕面板或视频画面深色条。
 * @param popoverOffset 弹窗底边到按钮顶边的间距。
 * @param onMenuOpenChange 菜单/参数弹窗展开状态变化时回调。
 * @param showLabel 是否显示模式文字。
 */
export default function TrainingMenuButton({
    tone,
    popoverOffset,
    onMenuOpenChange,
    showLabel = true,
}: {
    tone: ToolbarTone;
    popoverOffset: number;
    onMenuOpenChange?: (open: boolean) => void;
    showLabel?: boolean;
}) {
    const { t } = useI18nTranslation('player');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const popover = usePopover({
        className: cn('w-[340px] max-w-[calc(100vw-2rem)] p-2.5', CONTROL_POPOVER_PANEL),
        hasSurface: false,
        isModal: false,
        dialogLabel: t('controlBar.trainingMenuLabel'),
    });
    const trainingMenuOpen = popover.isOpen;

    useEffect(() => {
        onMenuOpenChange?.(trainingMenuOpen || settingsOpen);
    }, [trainingMenuOpen, settingsOpen, onMenuOpenChange]);

    const singleRepeat = usePlayer((s) => s.singleRepeat);
    const autoPause = usePlayer((s) => s.autoPause);
    const shadowing = usePlayer((s) => s.shadowing);
    const sentenceLoop = usePlayer((s) => s.sentenceLoop);
    const activePlan = usePlayer((s) => s.activePlan);
    const playbackRate = usePlayerState((s) => s.playbackRate);
    const trainingConfig = useTrainingModeStore((s) => s.config);
    const skipGap = useTrainingModeStore((s) => s.skipGap);
    const rewindOnResume = useTrainingModeStore((s) => s.rewindOnResume);

    const repeatShortcut = useSetting((s) => s.setting('shortcut.repeatSingleSentence'));
    const autoPauseShortcut = useSetting((s) => s.setting('shortcut.autoPause'));
    const repeatKey = primaryShortcutKey(repeatShortcut);
    const autoPauseKey = primaryShortcutKey(autoPauseShortcut);

    const style = TOOLBAR_TONE[tone];

    // 两种逐句循环配置互斥：×N 模式不带倍速表，精听模式带倍速表
    const loopTimesActive = sentenceLoop !== null && !sentenceLoop.rates;
    const loopRatesActive = sentenceLoop !== null && !!sentenceLoop.rates;
    const trainingActive = sentenceLoop !== null || shadowing || skipGap || rewindOnResume;

    const activeSentenceEndMode = deriveSentenceEndMode(
        { autoPause, singleRepeat, shadowing },
        sentenceLoop !== null,
    );
    const trainingLabel = (() => {
        switch (activeSentenceEndMode) {
            case 'singleRepeat':
                return t('controlBar.modeSingleRepeat');
            case 'autoPause':
                return t('controlBar.modeAutoPause');
            case 'sentenceLoop':
                return loopRatesActive
                    ? t('controlBar.modeLoopRates')
                    : t('controlBar.modeLoopTimes', { times: trainingConfig.repeatTimes });
            default:
                return t('controlBar.modeTraining');
        }
    })();

    const loopCountText = activePlan
        ? `${String(activePlan.loopDone + 1).padStart(String(activePlan.loopTotal).length, '0')}/${activePlan.loopTotal}`
        : '';

    const loopTotalDigits = sentenceLoop
        ? String(sentenceLoop.rates ? sentenceLoop.rates.length : sentenceLoop.times).length
        : 1;
    const progressSlotWidth = loopRatesActive
        ? `calc(${5 + loopTotalDigits * 2 + 3}ch + 0.625rem)`
        : `calc(${loopTotalDigits * 2 + 1}ch + 0.5rem)`;

    const trainingTooltipContent = (() => {
        switch (activeSentenceEndMode) {
            case 'singleRepeat':
                return `${t('controlBar.tooltipSingleRepeat')}${formatShortcut(repeatShortcut)}`;
            case 'autoPause':
                return `${t('controlBar.tooltipAutoPause')}${formatShortcut(autoPauseShortcut)}`;
            case 'sentenceLoop':
                return loopRatesActive
                    ? t('controlBar.tooltipLoopRates', {
                        rate: playbackRate,
                        done: (activePlan?.loopDone ?? 0) + 1,
                        total: activePlan?.loopTotal ?? trainingConfig.progressiveRates.length,
                    })
                    : t('controlBar.tooltipLoopTimes', {
                        times: trainingConfig.repeatTimes,
                        done: (activePlan?.loopDone ?? 0) + 1,
                        total: activePlan?.loopTotal ?? trainingConfig.repeatTimes,
                    });
            default:
                return trainingActive
                    ? t('controlBar.tooltipTrainingActive')
                    : t('controlBar.tooltipTrainingIdle');
        }
    })();

    return (
        <>
            <Tooltip content={trainingTooltipContent} placement="above">
                <button
                    type="button"
                    ref={popover.triggerRef}
                    onClick={popover.toggle}
                    {...popover.triggerProps}
                    aria-label={t('controlBar.trainingMenuLabel')}
                    className={cn(
                        (loopTimesActive || loopRatesActive || showLabel)
                            ? TOOLBAR_TEXT_BUTTON
                            : TOOLBAR_ICON_BUTTON,
                        trainingActive
                            ? style.accent.emerald
                            : style.idle
                    )}
                >
                    <Headphones className="w-4 h-4 shrink-0" />
                    {showLabel ? <span className="font-sans">{trainingLabel}</span> : null}

                    {loopTimesActive || loopRatesActive ? (
                        <span
                            className="inline-flex items-center justify-center gap-0.5"
                            style={{ minWidth: progressSlotWidth }}
                        >
                            {loopTimesActive ? (
                                activePlan ? <span className={cn(TOOLBAR_BADGE, style.badge)}>{loopCountText}</span> : null
                            ) : activePlan ? (
                                <>
                                    <span className={cn(TOOLBAR_BADGE, style.badge)}>{playbackRate.toFixed(2)}x</span>
                                    <span className={cn('font-mono text-xs', tone === 'overlay' ? 'text-media-fg/70' : 'text-muted-foreground')}>{`(${loopCountText})`}</span>
                                </>
                            ) : null}
                        </span>
                    ) : null}
                </button>
            </Tooltip>
            {popover.render(
                <>
                    <div className="space-y-1.5">
                        {/* 第一分区：互斥句末模式选择 */}
                        <div
                            role="radiogroup"
                            tabIndex={-1}
                            aria-label={t('controlBar.trainingMenuLabel')}
                            onKeyDown={(event) => {
                                if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
                                const radios = Array.from(
                                    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
                                );
                                const current = radios.findIndex((radio) => radio === document.activeElement);
                                if (current === -1) return;
                                event.preventDefault();
                                const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
                                const next = radios[(current + step + radios.length) % radios.length];
                                next.focus();
                                next.click();
                            }}
                        >
                            <VStack gap={0.5}>
                                <ModeOptionRow
                                    isActive={activeSentenceEndMode === 'off'}
                                    icon={<Play className="w-4 h-4" />}
                                    label={t('controlBar.rowNormalPlayback')}
                                    onSelect={() => {
                                        playerActions.setSingleRepeat(false);
                                        playerActions.setAutoPause(false);
                                        playerActions.setShadowing(false);
                                        playerActions.setSentenceLoop(null);
                                    }}
                                    testId="training-mode-off"
                                />
                                <ModeOptionRow
                                    isActive={singleRepeat}
                                    icon={<Repeat1 className="w-4 h-4" />}
                                    label={t('controlBar.rowSingleRepeat')}
                                    rightContent={repeatKey ? <Kbd keys={repeatKey} /> : undefined}
                                    title={repeatShortcut ? `${t('controlBar.rowSingleRepeat')} (${t('controlBar.shortcutHint', { shortcut: repeatShortcut })})` : t('controlBar.rowSingleRepeat')}
                                    onSelect={() => playerActions.setSingleRepeat(!singleRepeat)}
                                    testId="training-mode-single-repeat"
                                />
                                <ModeOptionRow
                                    isActive={autoPause}
                                    icon={<CirclePause className="w-4 h-4" />}
                                    label={t('controlBar.rowAutoPause')}
                                    rightContent={autoPauseKey ? <Kbd keys={autoPauseKey} /> : undefined}
                                    title={autoPauseShortcut ? `${t('controlBar.rowAutoPause')} (${t('controlBar.shortcutHint', { shortcut: autoPauseShortcut })})` : t('controlBar.rowAutoPause')}
                                    onSelect={() => playerActions.setAutoPause(!autoPause)}
                                    testId="training-mode-auto-pause"
                                />
                                <ModeOptionRow
                                    isActive={loopTimesActive}
                                    icon={<Repeat className="w-4 h-4" />}
                                    label={t('controlBar.rowLoopTimes')}
                                    rightContent={(
                                        <ParamBadge
                                            label={t('controlBar.rowLoopTimesHint', { times: trainingConfig.repeatTimes })}
                                            active={loopTimesActive}
                                        />
                                    )}
                                    title={t('controlBar.loopTimesTitle', { times: trainingConfig.repeatTimes })}
                                    onSelect={() => {
                                        playerActions.setSentenceLoop(loopTimesActive ? null : { times: trainingConfig.repeatTimes });
                                    }}
                                    testId="training-mode-loop-times"
                                />
                                <ModeOptionRow
                                    isActive={loopRatesActive}
                                    icon={<Gauge className="w-4 h-4" />}
                                    label={t('controlBar.rowLoopRates')}
                                    rightContent={(
                                        <ParamBadge
                                            label={formatRateChain(trainingConfig.progressiveRates)}
                                            active={loopRatesActive}
                                        />
                                    )}
                                    title={t('controlBar.loopRatesTitle', { rates: trainingConfig.progressiveRates.map((r) => `${r}x`).join(' → ') })}
                                    onSelect={() => {
                                        playerActions.setSentenceLoop(
                                            loopRatesActive
                                                ? null
                                                : { times: trainingConfig.progressiveRates.length, rates: trainingConfig.progressiveRates }
                                        );
                                    }}
                                    testId="training-mode-loop-rates"
                                />
                            </VStack>
                        </div>

                        <Divider variant="subtle" />

                        {/* 第二分区：独立辅助播放偏好开关 */}
                        <VStack gap={0.5}>
                            <PopoverSwitchRow
                                label={t('controlBar.rowSkipGap')}
                                labelTooltip={t('controlBar.skipGapTitle')}
                                checked={skipGap}
                                onChange={() => playerActions.setSkipGap(!skipGap)}
                                testId="training-assist-skip-gap"
                            />
                            <PopoverSwitchRow
                                label={t('controlBar.rowRewindOnResume')}
                                labelTooltip={t('controlBar.rewindTitle')}
                                checked={rewindOnResume}
                                onChange={() => playerActions.setRewindOnResume(!rewindOnResume)}
                                testId="training-assist-rewind-resume"
                            />
                        </VStack>

                        <Divider variant="subtle" />

                        {/* 第三分区：自定义训练参数弹窗入口 */}
                        <button
                            type="button"
                            onClick={() => {
                                popover.hide();
                                setSettingsOpen(true);
                            }}
                            data-testid="training-settings-button"
                            className="group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground cursor-pointer"
                        >
                            <span className="flex items-center gap-1.5">
                                <SlidersHorizontal className="h-3.5 w-3.5 text-secondary group-hover:text-primary transition-colors" />
                                <span>{t('controlBar.rowSettings')}</span>
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 text-secondary group-hover:text-foreground transition-colors" />
                        </button>
                    </div>
                </>,
                { placement: 'above', alignment: 'end', offset: popoverOffset },
            )}

            <TrainingSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </>
    );
}
