/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useCallback, useState } from 'react';
import { ChevronRight, Eraser, Settings2, SlidersHorizontal } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { VStack } from '@astryxdesign/core/VStack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';

import { usePopover } from '@astryxdesign/core/Popover';

import { cn } from '@/fronted/lib/utils';
import {
    CONTROL_POPOVER_PANEL,
} from '@/fronted/features/player/components/ControlPopover';
import { playerApi } from '@/fronted/features/player/playerApi';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import { setPodcastModeForCurrentVideo } from '@/fronted/features/player/podcastMode';
import { useSourceChineseAvailability } from '@/fronted/features/player/hooks/useSourceChineseAvailability';
import useSetting from '@/fronted/features/settings/settingsStore';
import { PopoverSwitchRow } from './PopoverSwitchRow';
import TimeAdjustPanel from './TimeAdjustPanel';
import {
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';

/**
 * 播放控制快速面板（播放台遥控器）。
 *
 * 遵循极简遥控器交互定位：
 * 1. 主选项卡只收纳 3~4 项高频即时干预项（整句显示、悬停查词暂停、自动播放下一集，及自带源字幕中文）；
 * 2. 避免与字幕条左侧的 EN/中/双语分段开关重复；低频或非即时项由底部「全部播放设置」承接；
 * 3. 顶层分段切换「常规」与「字幕时间」，高度压缩至约 190px，任何小视口下彻底杜绝滚动条。
 *
 * @param tone 宿主底色：字幕面板或视频画面深色条。
 * @param popoverOffset 弹窗底边到按钮顶边的间距。
 * @param onMenuOpenChange 展开状态变化时回调：宿主控制条据此保持可见。
 */
export default function PlayerSettingsPopover({
    tone,
    popoverOffset,
    onMenuOpenChange,
}: {
    tone: ToolbarTone;
    popoverOffset: number;
    onMenuOpenChange?: (open: boolean) => void;
}) {
    const { t } = useI18nTranslation('player');
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'settings' | 'timing'>('settings');

    const handlePopoverShow = useCallback(() => {
        onMenuOpenChange?.(true);
    }, [onMenuOpenChange]);
    const handlePopoverHide = useCallback(() => {
        setActiveTab('settings');
        onMenuOpenChange?.(false);
    }, [onMenuOpenChange]);
    const popover = usePopover({
        className: cn('w-[280px] p-2.5', CONTROL_POPOVER_PANEL),
        hasSurface: false,
        isModal: false,
        dialogLabel: t('controlBox.title'),
        onShow: handlePopoverShow,
        onHide: handlePopoverHide,
    });

    const showCn = usePlayerUi((s) => s.showCn);
    const showSourceZh = usePlayerUi((s) => s.showSourceZh);
    const sentenceBlockMode = usePlayerUi((s) => s.sentenceBlockMode);
    const changeShowSourceZh = usePlayerUi((s) => s.changeShowSourceZh);
    const changeSentenceBlockMode = usePlayerUi((s) => s.changeSentenceBlockMode);
    const sourceZhAvailable = useSourceChineseAvailability();
    const podcastMode = useLayout((s) => s.podcastMode);

    const pauseOnWordHover = useSetting((s) => s.values.get('player.pauseOnWordHover')) === 'true';
    const vocabularyGuidance = useSetting((s) => s.values.get('player.vocabularyGuidance') ?? 'calm');
    const adaptiveChinese = useSetting((s) => s.values.get('player.adaptiveChinese') ?? 'true') === 'true';
    const sceneCues = useSetting((s) => s.values.get('player.sceneCues') ?? 'false') === 'true';
    const setSetting = useSetting((s) => s.setSetting);

    const autoPlayNext = useSetting((s) => s.values.get('player.autoPlayNext')) === 'true';
    const currentSentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjustDiff = currentSentence && srtTender && srtTender.adjusted(currentSentence)
        ? srtTender.timeDiff(currentSentence)
        : null;

    const style = TOOLBAR_TONE[tone];

    const changePauseOnWordHover = async (next: boolean) => {
        await setSetting('player.pauseOnWordHover', next ? 'true' : 'false');
    };

    const changeAutoPlayNext = async (next: boolean) => {
        await setSetting('player.autoPlayNext', next ? 'true' : 'false');
    };

    const changeVocabularyGuidance = async (next: string) => {
        await setSetting('player.vocabularyGuidance', next);
    };

    const changeAdaptiveChinese = async (next: boolean) => {
        await setSetting('player.adaptiveChinese', next ? 'true' : 'false');
    };

    const changeSceneCues = async (next: boolean) => {
        await setSetting('player.sceneCues', next ? 'true' : 'false');
    };

    return (
        <>
            <Tooltip content={t('controlBox.title')} placement="above">
                <button
                    type="button"
                    ref={popover.triggerRef}
                    onClick={popover.toggle}
                    {...popover.triggerProps}
                    aria-label={t('controlBox.title')}
                    className={cn(
                        TOOLBAR_ICON_BUTTON,
                        style.idle
                    )}
                >
                    <SlidersHorizontal className="w-4 h-4" />
                </button>
            </Tooltip>
            {popover.render(
                <>
                {/* 顶部分段切换器：精简文案为 常规 / 字幕时间 */}
                <div className="pb-2">
                    <SegmentedControl
                        value={activeTab}
                        onChange={(val) => setActiveTab(val as 'settings' | 'timing')}
                        label={t('controlBox.title')}
                        size="sm"
                        layout="fill"
                    >
                        <SegmentedControlItem
                            value="settings"
                            label={t('controlBox.tabGeneral', { defaultValue: '常规' })}
                        />
                        <SegmentedControlItem
                            value="timing"
                            label={
                                adjustDiff
                                    ? `${t('controlBox.tabTiming', { defaultValue: '字幕时间' })} (${adjustDiff.start >= 0 ? '+' : ''}${adjustDiff.start.toFixed(1)}s)`
                                    : t('controlBox.tabTiming', { defaultValue: '字幕时间' })
                            }
                        />
                    </SegmentedControl>
                </div>

                {activeTab === 'settings' ? (
                    <div className="space-y-1.5">
                        {/* 极简 3~4 行高频即时开关 */}
                        <VStack gap={0.5}>
                            <PopoverSwitchRow
                                label={t('controlBox.sentenceBlockMode')}
                                labelTooltip={t('controlBox.sentenceBlockModeHint')}
                                checked={sentenceBlockMode}
                                onChange={() => changeSentenceBlockMode()}
                                testId="player-setting-sentence-block"
                            />
                            <PopoverSwitchRow
                                label={t('controlBox.pauseOnWordHover')}
                                labelTooltip={t('controlBox.pauseOnWordHoverHint')}
                                checked={pauseOnWordHover}
                                onChange={(next) => { void changePauseOnWordHover(next); }}
                                testId="player-setting-pause-on-hover"
                            />
                            <PopoverSwitchRow
                                label={t('controlBox.autoPlayNext')}
                                labelTooltip={t('controlBox.autoPlayNextHint')}
                                checked={autoPlayNext}
                                onChange={(next) => { void changeAutoPlayNext(next); }}
                                testId="player-setting-auto-play-next"
                            />
                            <PopoverSwitchRow
                                label={t('controlBox.podcastMode')}
                                labelTooltip={t('controlBox.podcastModeHint')}
                                checked={podcastMode}
                                onChange={(checked) => setPodcastModeForCurrentVideo(checked)}
                                testId="player-setting-podcast-mode"
                            />
                            {sourceZhAvailable && (
                                <PopoverSwitchRow
                                    label={t('controlBox.showSourceZh')}
                                    labelTooltip={t('controlBox.showSourceZhHint')}
                                    checked={showSourceZh}
                                    onChange={() => changeShowSourceZh()}
                                    testId="player-setting-show-source-zh"
                                />
                            )}
                            {(showCn || showSourceZh) && (
                                <PopoverSwitchRow
                                    label={t('controlBox.adaptiveChinese')}
                                    labelTooltip={t('controlBox.adaptiveChineseHint')}
                                    checked={adaptiveChinese}
                                    onChange={(next) => { void changeAdaptiveChinese(next); }}
                                    testId="player-setting-adaptive-chinese"
                                />
                            )}
                            <PopoverSwitchRow
                                label={t('controlBox.sceneCues')}
                                labelTooltip={t('controlBox.sceneCuesHint')}
                                checked={sceneCues}
                                onChange={(next) => { void changeSceneCues(next); }}
                                testId="player-setting-scene-cues"
                            />
                        </VStack>

                        <div className="flex items-center justify-between gap-2 px-2 py-1">
                            <span
                                className="text-sm text-muted-foreground"
                                title={t('controlBox.vocabularyGuidanceHint')}
                            >
                                {t('controlBox.vocabularyGuidance')}
                            </span>
                            <SegmentedControl
                                value={vocabularyGuidance}
                                onChange={(next) => { void changeVocabularyGuidance(next); }}
                                label={t('controlBox.vocabularyGuidance')}
                                size="sm"
                            >
                                <SegmentedControlItem
                                    value="off"
                                    label={t('controlBox.vocabularyGuidanceOff')}
                                />
                                <SegmentedControlItem
                                    value="calm"
                                    label={t('controlBox.vocabularyGuidanceCalm')}
                                />
                                <SegmentedControlItem
                                    value="coach"
                                    label={t('controlBox.vocabularyGuidanceCoach')}
                                />
                            </SegmentedControl>
                        </div>

                        <Divider variant="subtle" />

                        {/* 底部跳转完整系统设置 */}
                        <button
                            type="button"
                            onClick={() => {
                                popover.hide();
                                navigate('/settings/appearance');
                            }}
                            className="group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground cursor-pointer"
                        >
                            <span className="flex items-center gap-1.5">
                                <Settings2 className="h-3.5 w-3.5 text-secondary group-hover:text-primary transition-colors" />
                                <span>{t('controlBox.allSettings', { defaultValue: '全部播放设置' })}</span>
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 text-secondary group-hover:text-foreground transition-colors" />
                        </button>
                    </div>
                ) : (
                    /* 时间微调选项卡：单一任务、原地微调 */
                    <div className="space-y-3 pt-1">
                        <div className="rounded-xl border border-border/40 bg-muted/20 p-2.5">
                            <TimeAdjustPanel />
                        </div>

                        <Divider variant="subtle" />

                        <Button
                            variant="ghost"
                            size="sm"
                            width="100%"
                            label={t('clearAdjust.button')}
                            icon={<Eraser className="h-4 w-4" />}
                            tooltip={t('clearAdjust.tooltipSubtitle')}
                            onClick={() => {
                                const fileHash = usePlaybackSession.getState().srtHash;
                                if (!fileHash) return;
                                void playerApi.deleteTimestampAdjustment(fileHash).then(() => {
                                    usePlaybackSession.getState().reloadSubtitles();
                                    toast(t('clearAdjust.done'), { icon: '👏' });
                                });
                            }}
                        />
                    </div>
                )}
                </>,
                { placement: 'above', alignment: 'end', offset: popoverOffset },
            )}
        </>
    );
}
