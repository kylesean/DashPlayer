import { CirclePause, Repeat1 } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import PracticeModeButton from '@/fronted/features/player/components/srt-layout/PracticeModeButton';
import LearningModeButton from '@/fronted/features/player/components/srt-layout/LearningModeButton';
import { formatShortcut } from '@/fronted/features/player/components/formatShortcut';
import PlayerSettingsPopover from './PlayerSettingsPopover';
import SubtitleTrackSegmented from './SubtitleTrackSegmented';
import TimeAdjustPopover from './TimeAdjustPopover';
import TrainingMenuButton from './TrainingMenuButton';
import {
    TOOLBAR_DIVIDER,
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TONE,
} from './toolbarStyles';

/**
 * 学习台弹层与工具条之间的间距。
 *
 * 工具条是面板布局里的最后一行，不和进度条抢空间，留一点视觉呼吸即可。
 */
const POPOVER_OFFSET = 8;

/**
 * 主字幕学习台：固定在字幕面板底部的工具条。
 *
 * 分层约定：视频控制条只管“看”（播放、进度、倍速、音量、遮挡、全屏），
 * 这里只放“学”（轨道、循环/句末暂停/训练、跟读、整句学习、时间微调、设置）。
 * 它占的是面板布局里的真实一行，不是悬浮层，因此永远不会盖住字幕。
 *
 * 常态降一档对比度，鼠标进入字幕区再升满：控件是配角，句子是主角。
 */
export default function LearningToolbar() {
    const { t } = useI18nTranslation('player');
    const singleRepeat = usePlayer((s) => s.singleRepeat);
    const autoPause = usePlayer((s) => s.autoPause);
    const repeatShortcut = useSetting((s) => s.setting('shortcut.repeatSingleSentence'));
    const autoPauseShortcut = useSetting((s) => s.setting('shortcut.autoPause'));

    const style = TOOLBAR_TONE.panel;

    return (
        <div
            className={cn(
                'flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/50 px-2',
                'text-muted-foreground transition-opacity duration-200',
                'opacity-75 focus-within:opacity-100 group-hover/subtitles:opacity-100',
                '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            )}
        >
            <SubtitleTrackSegmented tone="panel" />

            <span className={cn(TOOLBAR_DIVIDER, style.divider)} />

            {/* 精听两个最常用开关：与训练菜单里的开关是同一份状态，只是快速入口 */}
            <Tooltip
                content={`${t('controlBar.modeSingleRepeat')}${formatShortcut(repeatShortcut)}`}
                placement="above"
            >
                <button
                    type="button"
                    onClick={() => playerActions.setSingleRepeat(!singleRepeat)}
                    aria-pressed={singleRepeat}
                    aria-label={t('controlBar.modeSingleRepeat')}
                    className={cn(
                        TOOLBAR_ICON_BUTTON,
                        singleRepeat ? style.accent.amber : style.idle
                    )}
                >
                    <Repeat1 className="w-3.5 h-3.5 stroke-[2.2]" />
                </button>
            </Tooltip>

            <Tooltip
                content={`${t('controlBar.modeAutoPause')}${formatShortcut(autoPauseShortcut)}`}
                placement="above"
            >
                <button
                    type="button"
                    onClick={() => playerActions.setAutoPause(!autoPause)}
                    aria-pressed={autoPause}
                    aria-label={t('controlBar.modeAutoPause')}
                    className={cn(
                        TOOLBAR_ICON_BUTTON,
                        autoPause ? style.accent.emerald : style.idle
                    )}
                >
                    <CirclePause className="w-3.5 h-3.5 stroke-[2.2]" />
                </button>
            </Tooltip>

            <TrainingMenuButton tone="panel" popoverOffset={POPOVER_OFFSET} />

            <span className={cn(TOOLBAR_DIVIDER, style.divider)} />

            <PracticeModeButton variant="toolbar" />
            <LearningModeButton variant="toolbar" />
            <TimeAdjustPopover tone="panel" popoverOffset={POPOVER_OFFSET} />

            <div className="flex-1" />

            <PlayerSettingsPopover tone="panel" popoverOffset={POPOVER_OFFSET} />
        </div>
    );
}
