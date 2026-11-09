import { useEffect, useState } from 'react';
import {
    CirclePause,
    Dumbbell,
    FastForward,
    Gauge,
    Mic,
    Repeat,
    Repeat1,
    RotateCcw,
    Settings2,
    Sparkles,
} from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/fronted/components/ui/popover';
import {
    CONTROL_POPOVER_HINT,
    CONTROL_POPOVER_ICON,
    CONTROL_POPOVER_LABEL,
    CONTROL_POPOVER_PANEL,
    CONTROL_POPOVER_SEPARATOR,
    ControlPopoverRow,
} from '@/fronted/features/player/components/ControlPopover';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { useTrainingModeStore } from '@/fronted/features/player/trainingStore';
import { TrainingSettingsDialog } from '@/fronted/features/player/components/TrainingSettingsDialog';
import useSetting from '@/fronted/features/settings/settingsStore';
import { formatShortcut } from '@/fronted/features/player/components/formatShortcut';
import {
    TOOLBAR_BADGE,
    TOOLBAR_TEXT_BUTTON,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';

/**
 * 训练模式入口：一个按钮 + 一个菜单。
 *
 * 按钮文字表达“当前是哪种模式”（单句循环 / 句末暂停 / 影子跟读 / 递进倍速…），
 * 右侧只挂「进行到哪一步」的中性徽章；模式的具体参数在菜单最后一行进入设置弹窗。
 *
 * 普通视图挂在字幕学习台，全屏视图挂在画面控制条，两处共用同一份实现。
 *
 * @param tone 宿主底色：字幕面板或视频画面深色条。
 * @param popoverOffset 弹窗底边到按钮顶边的间距，按宿主控制条形状取。
 * @param onMenuOpenChange 菜单/参数弹窗展开状态变化时回调：宿主据此保持可见。
 * @param showLabel 是否显示模式文字；窄面板只留图标 + 进度徽章，tooltip 仍给出完整模式。
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
    const [trainingMenuOpen, setTrainingMenuOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        onMenuOpenChange?.(trainingMenuOpen || settingsOpen);
    }, [trainingMenuOpen, settingsOpen, onMenuOpenChange]);

    const singleRepeat = usePlayer((s) => s.singleRepeat);
    const autoPause = usePlayer((s) => s.autoPause);
    const shadowing = usePlayer((s) => s.shadowing);
    const shadowingPause = usePlayer((s) => s.shadowingPause);
    const sentenceLoop = usePlayer((s) => s.sentenceLoop);
    const activePlan = usePlayer((s) => s.activePlan);
    const playbackRate = usePlayerState((s) => s.playbackRate);
    const trainingConfig = useTrainingModeStore((s) => s.config);
    const skipGap = useTrainingModeStore((s) => s.skipGap);
    const rewindOnResume = useTrainingModeStore((s) => s.rewindOnResume);

    const repeatShortcut = useSetting((s) => s.setting('shortcut.repeatSingleSentence'));
    const autoPauseShortcut = useSetting((s) => s.setting('shortcut.autoPause'));

    const style = TOOLBAR_TONE[tone];

    // 两种逐句循环配置互斥：×N 模式不带倍速表，精听模式带倍速表
    const loopTimesActive = sentenceLoop !== null && !sentenceLoop.rates;
    const loopRatesActive = sentenceLoop !== null && !!sentenceLoop.rates;
    const trainingActive = sentenceLoop !== null || skipGap || shadowing || rewindOnResume;
    // 模式身份由按钮文字表达（图标固定一颗，不再逐模式换图标、换色），优先级与 tooltip 一致
    const trainingLabel = singleRepeat
        ? t('controlBar.modeSingleRepeat')
        : autoPause
        ? t('controlBar.modeAutoPause')
        : shadowing
        ? t('controlBar.modeShadowing')
        : loopTimesActive
        ? t('controlBar.modeLoopTimes', { times: trainingConfig.repeatTimes })
        : loopRatesActive
        ? t('controlBar.modeLoopRates')
        : t('controlBar.modeTraining');

    // 进度徽章里的数字：按总数位数补零，避免 9→10 这类跨位时把按钮撑宽
    const loopCountText = activePlan
        ? `${String(activePlan.loopDone + 1).padStart(String(activePlan.loopTotal).length, '0')}/${activePlan.loopTotal}`
        : '';
    // 徽章槽位的固定宽度：按当前模式最长内容算（内容全是 10px 等宽字，ch 即一个字符宽）。
    // 槽位常驻、内容缺失时留透明占位，训练按钮的宽度才不会随「第几遍 / 当前倍速 / 留白倒计时」抖动。
    const loopTotalDigits = sentenceLoop
        ? String(sentenceLoop.rates ? sentenceLoop.rates.length : sentenceLoop.times).length
        : 1;
    const progressSlotWidth = loopRatesActive
        ? `calc(${5 + loopTotalDigits * 2 + 3}ch + 0.625rem)` // 「1.00x」+ 间距 + 「(N/M)」
        : `calc(${loopTotalDigits * 2 + 1}ch + 0.5rem)`; // 「N/M」；影子跟读倒计时位数更少，共用同一槽位

    const trainingTooltipContent = singleRepeat
        ? `${t('controlBar.tooltipSingleRepeat')}${formatShortcut(repeatShortcut)}`
        : autoPause
        ? `${t('controlBar.tooltipAutoPause')}${formatShortcut(autoPauseShortcut)}`
        : shadowing
        ? `${t('controlBar.tooltipShadowing')}${shadowingPause ? t('controlBar.tooltipShadowingPausing') : ''}`
        : loopTimesActive
        ? t('controlBar.tooltipLoopTimes', {
            times: trainingConfig.repeatTimes,
            done: (activePlan?.loopDone ?? 0) + 1,
            total: activePlan?.loopTotal ?? trainingConfig.repeatTimes,
        })
        : loopRatesActive
        ? t('controlBar.tooltipLoopRates', {
            rate: playbackRate,
            done: (activePlan?.loopDone ?? 0) + 1,
            total: activePlan?.loopTotal ?? trainingConfig.progressiveRates.length,
        })
        : trainingActive
        ? t('controlBar.tooltipTrainingActive')
        : t('controlBar.tooltipTrainingIdle');

    return (
        <>
            <Popover open={trainingMenuOpen} onOpenChange={setTrainingMenuOpen}>
                <Tooltip content={trainingTooltipContent} placement="above">
                    <PopoverTrigger asChild>
                        <button
                            className={cn(
                                TOOLBAR_TEXT_BUTTON,
                                // 画面控制条上倍速/音量是 32px，这里必须同高；字幕面板里跟 28px 图标对齐
                                tone === 'overlay' && 'h-8',
                                trainingActive
                                    ? style.accent.emerald
                                    : style.idle
                            )}
                        >
                            <Dumbbell className="w-3.5 h-3.5" />
                            {showLabel ? <span className="font-sans">{trainingLabel}</span> : null}

                            {/* 进度徽章槽位：宽度按模式最长内容钉死、常驻（内容缺失时透明占位），
                                徽章数字再怎么变也不会撑宽按钮 */}
                            {loopTimesActive || loopRatesActive || shadowing ? (
                                <span
                                    className="inline-flex items-center justify-center gap-0.5"
                                    style={{ minWidth: progressSlotWidth }}
                                >
                                    {loopTimesActive ? (
                                        activePlan ? <span className={cn(TOOLBAR_BADGE, style.badge)}>{loopCountText}</span> : null
                                    ) : loopRatesActive ? (
                                        activePlan ? (
                                            <>
                                                <span className={cn(TOOLBAR_BADGE, style.badge)}>{playbackRate.toFixed(2)}x</span>
                                                <span className={cn('font-mono text-[10px]', tone === 'overlay' ? 'text-white/70' : 'text-muted-foreground')}>{`(${loopCountText})`}</span>
                                            </>
                                        ) : null
                                    ) : shadowingPause ? (
                                        <ShadowCountdown key={shadowingPause.untilTs} untilTs={shadowingPause.untilTs} tone={tone} />
                                    ) : null}
                                </span>
                            ) : null}
                        </button>
                    </PopoverTrigger>
                </Tooltip>
                <PopoverContent
                    side="top"
                    align="end"
                    sideOffset={popoverOffset}
                    className={cn('w-64', CONTROL_POPOVER_PANEL)}
                >
                    <div className={cn('flex items-center gap-1.5', CONTROL_POPOVER_LABEL)}>
                        <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                        {t('controlBar.trainingMenuLabel')}
                    </div>
                    <div className={CONTROL_POPOVER_SEPARATOR} />
                    {/* 句末行为（引擎层互斥：开启任一自动关闭其他） */}
                    <ControlPopoverRow
                        checked={singleRepeat}
                        icon={<Repeat1 className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowSingleRepeat')}
                        right={repeatShortcut ? <span className={CONTROL_POPOVER_HINT}>{t('controlBar.shortcutHint', { shortcut: repeatShortcut })}</span> : undefined}
                        onActivate={() => playerActions.setSingleRepeat(!singleRepeat)}
                    />
                    <ControlPopoverRow
                        checked={autoPause}
                        icon={<CirclePause className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowAutoPause')}
                        right={autoPauseShortcut ? <span className={CONTROL_POPOVER_HINT}>{t('controlBar.shortcutHint', { shortcut: autoPauseShortcut })}</span> : undefined}
                        onActivate={() => playerActions.setAutoPause(!autoPause)}
                    />
                    <ControlPopoverRow
                        checked={shadowing}
                        icon={<Mic className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowShadowing')}
                        right={
                            <span className={CONTROL_POPOVER_HINT}>{t('controlBar.shadowingRatioHint', { ratio: trainingConfig.shadowingRatio.toFixed(1) })}</span>
                        }
                        title={t('controlBar.shadowingTitle', { ratio: trainingConfig.shadowingRatio.toFixed(1) })}
                        onActivate={() => playerActions.setShadowing(!shadowing)}
                    />
                    <ControlPopoverRow
                        checked={loopTimesActive}
                        icon={<Repeat className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowLoopTimes', { times: trainingConfig.repeatTimes })}
                        title={t('controlBar.loopTimesTitle', { times: trainingConfig.repeatTimes })}
                        onActivate={() => {
                            playerActions.setSentenceLoop(loopTimesActive ? null : { times: trainingConfig.repeatTimes });
                        }}
                    />
                    <ControlPopoverRow
                        checked={loopRatesActive}
                        icon={<Gauge className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowLoopRates')}
                        right={
                            <span className={CONTROL_POPOVER_HINT}>
                                {trainingConfig.progressiveRates.map((r) => `${r}x`).join('→')}
                            </span>
                        }
                        title={t('controlBar.loopRatesTitle', { rates: trainingConfig.progressiveRates.map((r) => `${r}x`).join(' → ') })}
                        onActivate={() => {
                            playerActions.setSentenceLoop(
                                loopRatesActive
                                    ? null
                                    : { times: trainingConfig.progressiveRates.length, rates: trainingConfig.progressiveRates }
                            );
                        }}
                    />
                    <div className={CONTROL_POPOVER_SEPARATOR} />
                    {/* 辅助播放行为 */}
                    <ControlPopoverRow
                        checked={skipGap}
                        icon={<FastForward className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowSkipGap')}
                        title={t('controlBar.skipGapTitle')}
                        onActivate={() => playerActions.setSkipGap(!skipGap)}
                    />
                    <ControlPopoverRow
                        checked={rewindOnResume}
                        icon={<RotateCcw className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowRewindOnResume')}
                        title={t('controlBar.rewindTitle')}
                        onActivate={() => playerActions.setRewindOnResume(!rewindOnResume)}
                    />
                    <div className={CONTROL_POPOVER_SEPARATOR} />
                    <ControlPopoverRow
                        icon={<Settings2 className={CONTROL_POPOVER_ICON} />}
                        label={t('controlBar.rowSettings')}
                        onActivate={() => {
                            setTrainingMenuOpen(false);
                            setSettingsOpen(true);
                        }}
                    />
                </PopoverContent>
            </Popover>

            <TrainingSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </>
    );
}

/**
 * 影子跟读留白剩余秒数徽章：按 200ms tick 派生渲染剩余时间。
 * 独立成子组件以隔离高频刷新；setState 仅在定时器回调中发生，挂载阶段无同步写状态。
 * @param untilTs 留白结束的时间戳（毫秒）
 * @param tone 徽章所在底色。
 */
function ShadowCountdown({ untilTs, tone }: { untilTs: number; tone: ToolbarTone }) {
    // 初始值在 useState 惰性初始化中派生（父级以 untilTs 作 key，变化即重挂载）；后续由定时器回调刷新
    const [secondsLeft, setSecondsLeft] = useState(() => Math.max(Math.ceil((untilTs - Date.now()) / 1000), 0));
    useEffect(() => {
        const intervalId = setInterval(() => {
            setSecondsLeft(Math.max(Math.ceil((untilTs - Date.now()) / 1000), 0));
        }, 200);
        return () => clearInterval(intervalId);
    }, [untilTs]);
    return (
        <span className={cn(TOOLBAR_BADGE, TOOLBAR_TONE[tone].badge, 'animate-pulse')}>
            {String(secondsLeft).padStart(2, '0')}s
        </span>
    );
}
