import { CirclePause, Repeat1 } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/frontend/lib/utils';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import { usePlayer } from '@/frontend/features/player/playerStore';
import useSetting from '@/frontend/features/settings/settingsStore';
import { formatShortcut } from '@/frontend/features/player/components/formatShortcut';
import PracticeModeButton from '@/frontend/features/player/components/srt-layout/PracticeModeButton';
import SubtitleTrackSegmented from './SubtitleTrackSegmented';
import {
    TOOLBAR_DIVIDER,
    TOOLBAR_ICON_BUTTON,
    TOOLBAR_TONE,
} from './toolbarStyles';

/**
 * 播客模式下的精简学习条。
 *
 * 播客视图会盖住主字幕面板与完整学习台，这里只保留听读时最常用的三件事：
 * 轨道切换、单句循环、句末暂停。退出播客由底部控制条上常显的按钮负责，
 * 这里不再重复一个入口。
 *
 * 浮在播客控制条上方而不是并进控制条：控制条负责“播放”，这条负责“学”，
 * 和窗口内“视频条 / 学习台”的分层保持一致。
 *
 * @param className 定位由调用方给（绝对定位在视图右下角）。
 */
export default function PodcastLearningBar({ className }: { className?: string }) {
    const { t } = useI18nTranslation('player');
    const singleRepeat = usePlayer((s) => s.singleRepeat);
    const autoPause = usePlayer((s) => s.autoPause);
    const repeatShortcut = useSetting((s) => s.setting('shortcut.repeatSingleSentence'));
    const autoPauseShortcut = useSetting((s) => s.setting('shortcut.autoPause'));

    const style = TOOLBAR_TONE.panel;

    return (
        <div
            className={cn(
                'inline-flex items-center gap-1 rounded-full border border-border/60 bg-body/85 px-1.5 py-1 shadow-sm backdrop-blur-sm',
                className
            )}
        >
            <SubtitleTrackSegmented tone="panel" />

            <span className={cn(TOOLBAR_DIVIDER, style.divider)} />

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

            <span className={cn(TOOLBAR_DIVIDER, style.divider)} />

            <PracticeModeButton variant="toolbar" />
        </div>
    );
}
