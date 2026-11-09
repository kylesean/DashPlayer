import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Eraser, History, SlidersHorizontal } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import useSWR, { useSWRConfig } from 'swr';
import toast from 'react-hot-toast';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/fronted/components/ui/popover';
import {
    CONTROL_POPOVER_HINT,
    CONTROL_POPOVER_ICON,
    CONTROL_POPOVER_LABEL,
    CONTROL_POPOVER_PANEL,
    CONTROL_POPOVER_ROW_BASE,
    CONTROL_POPOVER_ROW_IDLE,
    CONTROL_POPOVER_SEPARATOR,
    ControlPopoverRow,
} from '@/fronted/features/player/components/ControlPopover';
import { playerApi } from '@/fronted/features/player/playerApi';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import { isSidebarHiddenByEnglish } from '@/fronted/features/player/components/sidePanelVisibility';
import { setPodcastModeForCurrentVideo } from '@/fronted/features/player/podcastMode';
import TimeAdjustPanel from './TimeAdjustPanel';
import {
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';

/**
 * 弹层里紧跟某个开关的一行白话说明。
 *
 * 打在行下方而不是只塞 title：像「碎句合并」「随英文字幕隐藏」这类开关，
 * 光看勾选变化看不出它改的是显示还是数据，先给一句解释才不会点完一脸问号。
 */
const ROW_HINT = '-mt-1 px-2 pb-1.5 text-[10px] leading-snug text-secondary';

/**
 * 播放器设置：一个字幕面板/画面控制条共用的「⚙」。
 *
 * 这里收纳所有不在工具条上直接摆出来的开关，按“改什么”分组：
 * 字幕显示 → 字幕文件（解析数据） → 侧栏 → 播放偏好 → 时间微调。
 * 只有一份实现，普通视图与全屏视图不再各自维护一份设置弹层。
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
    const [open, setOpen] = useState(false);
    const [adjustOpen, setAdjustOpen] = useState(false);

    const showEn = usePlayerUi((s) => s.showEn);
    const showCn = usePlayerUi((s) => s.showCn);
    const showSourceZh = usePlayerUi((s) => s.showSourceZh);
    const sentenceBlockMode = usePlayerUi((s) => s.sentenceBlockMode);
    const showSideTranslation = usePlayerUi((s) => s.showSideTranslation);
    const syncSide = usePlayerUi((s) => s.syncSide);
    const changeShowEn = usePlayerUi((s) => s.changeShowEn);
    const changeShowCn = usePlayerUi((s) => s.changeShowCn);
    const changeShowSourceZh = usePlayerUi((s) => s.changeShowSourceZh);
    const changeSentenceBlockMode = usePlayerUi((s) => s.changeSentenceBlockMode);
    const changeShowSideTranslation = usePlayerUi((s) => s.changeShowSideTranslation);
    const changeSyncSide = usePlayerUi((s) => s.changeSyncSide);

    const pauseOnWordHover = useSetting((s) => s.values.get('player.pauseOnWordHover')) === 'true';
    const setSetting = useSetting((s) => s.setSetting);
    const englishTrackShortcut = useSetting((s) => s.setting('shortcut.toggleEnglishDisplay'));

    const autoPlayNext = usePlayer((s) => s.autoPlayNext);
    const currentSentence = usePlayerState((s) => s.currentSentence);
    const srtTender = usePlayerState((s) => s.srtTender);
    const adjustDiff = currentSentence && srtTender && srtTender.adjusted(currentSentence)
        ? srtTender.timeDiff(currentSentence)
        : null;
    const { podcastMode, changeFullScreen } = useLayout(useShallow((s) => ({
        podcastMode: s.podcastMode,
        changeFullScreen: s.changeFullScreen,
    })));

    // 意群重切分：解析层设置（sysConf），切换后重新打开视频生效；写走 system/config/set。
    const { mutate: mutateGlobalConfig } = useSWRConfig();
    const { data: meaningGroupRaw } = useSWR(
        'player/getMeaningGroupResegmentation',
        () => playerApi.getMeaningGroupResegmentation(),
    );
    const meaningGroupOn = meaningGroupRaw !== 'false';
    const changeMeaningGroupResegmentation = () => {
        const next = !meaningGroupOn;
        void playerApi.setMeaningGroupResegmentation(next);
        void mutateGlobalConfig('player/getMeaningGroupResegmentation', next ? 'true' : 'false', {
            revalidate: false,
        });
        // 这个开关改的是解析结果，当次播放不会变；不给提示会被当成“点了没反应”
        toast(t('controlBox.meaningGroupResegmentationChanged'));
    };

    // 侧栏此刻是否真的被收起：收起时提示要从“会怎样”换成“现在就是这样”
    const sidebarHidden = isSidebarHiddenByEnglish(syncSide, showEn);
    const style = TOOLBAR_TONE[tone];

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                onMenuOpenChange?.(next);
            }}
        >
            <Tooltip content={t('controlBox.title')} placement="above">
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={t('controlBox.title')}
                        className={cn(
                            TOOLBAR_ICON_BUTTON,
                            style.idle
                        )}
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                    </button>
                </PopoverTrigger>
            </Tooltip>
            <PopoverContent
                side="top"
                align="end"
                sideOffset={popoverOffset}
                className={cn('max-h-[70vh] w-64 overflow-y-auto', CONTROL_POPOVER_PANEL)}
            >
                <div className={CONTROL_POPOVER_LABEL}>{t('controlBox.subtitleTracks')}</div>
                <div className={CONTROL_POPOVER_SEPARATOR} />
                <ControlPopoverRow
                    checked={showEn}
                    label={t('controlBox.showEnglish')}
                    onActivate={() => changeShowEn()}
                />
                <ControlPopoverRow
                    checked={showCn}
                    label={t('controlBox.showChinese')}
                    onActivate={() => changeShowCn()}
                />
                <ControlPopoverRow
                    checked={showSourceZh}
                    label={t('controlBox.showSourceZh')}
                    onActivate={() => changeShowSourceZh()}
                />

                {/* 显示方式：只影响渲染与循环单位，字幕文件本身不变 */}
                <div className={CONTROL_POPOVER_SEPARATOR} />
                <div className={CONTROL_POPOVER_LABEL}>{t('controlBox.displayModeLabel')}</div>
                <ControlPopoverRow
                    checked={sentenceBlockMode}
                    label={t('controlBox.sentenceBlockMode')}
                    onActivate={() => changeSentenceBlockMode()}
                />
                <p className={ROW_HINT}>{t('controlBox.sentenceBlockModeHint')}</p>

                {/* 字幕文件：解析阶段改的是句子数据，必须重开视频 */}
                <div className={CONTROL_POPOVER_SEPARATOR} />
                <div className={CONTROL_POPOVER_LABEL}>{t('controlBox.subtitleFileLabel')}</div>
                <ControlPopoverRow
                    checked={meaningGroupOn}
                    label={t('controlBox.meaningGroupResegmentation')}
                    onActivate={changeMeaningGroupResegmentation}
                />
                <p className={ROW_HINT}>{t('controlBox.meaningGroupResegmentationHint')}</p>

                <div className={CONTROL_POPOVER_SEPARATOR} />
                <div className={CONTROL_POPOVER_LABEL}>{t('controlBox.sideGroupLabel')}</div>
                <ControlPopoverRow
                    checked={showSideTranslation}
                    label={t('controlBox.showSideTranslation')}
                    title={t('controlBox.sideTranslationHint')}
                    onActivate={() => changeShowSideTranslation()}
                />
                <ControlPopoverRow
                    checked={syncSide}
                    label={t('controlBox.sidebarFollowsEnglish')}
                    title={sidebarHidden ? t('controlBox.sidebarHiddenNow') : t('controlBox.sidebarFollowsEnglishHint')}
                    onActivate={() => {
                        const next = !syncSide;
                        changeSyncSide();
                        // 英文轨道还开着时，侧栏不会有任何变化；不给反馈会被当成“点了没反应”
                        if (next && showEn) {
                            toast(t('controlBox.sidebarFollowsEnglishEnabled', {
                                shortcut: (englishTrackShortcut || 'e').toUpperCase(),
                            }));
                        }
                    }}
                />

                <div className={CONTROL_POPOVER_SEPARATOR} />
                <div className={CONTROL_POPOVER_LABEL}>{t('controlBox.playbackGroupLabel')}</div>
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
                    checked={podcastMode}
                    label={t('controlBox.podcastMode')}
                    title={t('controlBox.podcastModeHint')}
                    onActivate={() => {
                        const next = !podcastMode;
                        changeFullScreen(false);
                        setPodcastModeForCurrentVideo(next);
                    }}
                />

                <div className={CONTROL_POPOVER_SEPARATOR} />
                <div className={CONTROL_POPOVER_LABEL}>{t('controlBox.timeGroupLabel')}</div>
                {/* 二级弹层：时间微调是低频、需要边看边调的操作，留在非模态浮层里，不写进设置列表 */}
                <Popover open={adjustOpen} onOpenChange={setAdjustOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(CONTROL_POPOVER_ROW_BASE, CONTROL_POPOVER_ROW_IDLE)}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="w-3.5 shrink-0" />
                                <History className={CONTROL_POPOVER_ICON} />
                                <span className="truncate">{t('subtitle.adjustTitle')}</span>
                            </span>
                            {adjustDiff ? (
                                <span className={CONTROL_POPOVER_HINT}>
                                    {`${adjustDiff.start >= 0 ? '+' : ''}${adjustDiff.start.toFixed(2)} / ${adjustDiff.end >= 0 ? '+' : ''}${adjustDiff.end.toFixed(2)}`}
                                </span>
                            ) : null}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        side="left"
                        align="start"
                        sideOffset={8}
                        className="w-72 p-3.5 gap-3 shadow-xl border-border/80 bg-popover/95 backdrop-blur-md"
                    >
                        <TimeAdjustPanel />
                    </PopoverContent>
                </Popover>
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
    );
}
