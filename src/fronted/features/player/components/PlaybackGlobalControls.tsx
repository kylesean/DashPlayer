import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayerState } from '@/fronted/features/player/playerState';
import useSetting from '@/fronted/features/settings/settingsStore';
import { formatShortcut } from '@/fronted/features/player/components/formatShortcut';

/**
 * 深色控制条上按钮的 hover 外观。
 *
 * 视频控制条的底色恒为深色（black/60 上叠白字），与应用主题无关，因此不能按 `dark:` 主题分支取反色：
 * 浅色主题下会退化成「背景加暗 + 文字转黑」，在黑底上等于没有 hover 反馈。
 * 本条上的按钮一律取这一份；宿主是亮色时才另给一套（见 learning-toolbar/toolbarStyles）。
 */
export const DARK_BAR_BUTTON_HOVER = 'hover:bg-media-fg/15 hover:text-media-fg';

/** 控制条上带文字的模式按钮：与纯图标按钮同高、同圆角。 */
export const MEDIA_BAR_TEXT_BUTTON = 'flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium leading-none transition-colors shrink-0';

/** 控制条上的开启态：统一中性白，不引入第二种语义色。 */
export const MEDIA_BAR_ACTIVE = 'bg-media-fg/20 text-media-fg ring-1 ring-media-fg/25';

/** 控制条按钮分组：模式、学习、播放工具各成一组。 */
export const MEDIA_BAR_GROUP = 'flex shrink-0 items-center gap-1 xl:gap-2';

/** 控制条分组之间的细分隔线。 */
export const MEDIA_BAR_DIVIDER = 'mx-0.5 h-5 w-px shrink-0 bg-media-fg/15';

/**
 * 图标按钮在深色控制条上的统一样式。
 */
const ICON_BUTTON_CLASS = cn(
    'w-7 h-7 flex items-center justify-center rounded-lg text-media-fg/80 transition-colors shrink-0',
    DARK_BAR_BUTTON_HOVER
);

/**
 * 播放导航控件：上一句 / 播放暂停 / 下一句。
 *
 * 普通视图与全屏视图的控制条共用；播放状态与指令直接读播放器 store，
 * 不自带文案，因此两条控制条的落点与宽度都一致。
 * 这里只做“播放”，训练/字幕/设置等学习动作在字幕学习台里。
 *
 * @returns 播放导航控件。
 */
export function PlaybackNavControls() {
    const { t } = useI18nTranslation('player');
    const playing = usePlayerState((s) => s.playing);
    const prevShortcut = useSetting((s) => s.setting('shortcut.previousSentence'));
    const nextShortcut = useSetting((s) => s.setting('shortcut.nextSentence'));
    const playPauseShortcut = useSetting((s) => s.setting('shortcut.playPause'));

    return (
        <div className="flex items-center gap-1 shrink-0">
            <Tooltip content={`${t('controlBar.prevSentence')}${formatShortcut(prevShortcut)}`} placement="above">
                <button
                    onClick={() => { void playerActions.prevSentence(); }}
                    className={ICON_BUTTON_CLASS}
                >
                    <SkipBack className="w-3.5 h-3.5" />
                </button>
            </Tooltip>

            <Tooltip content={`${playing ? t('controlBar.pause') : t('controlBar.play')}${formatShortcut(playPauseShortcut)}`} placement="above">
                <button
                    onClick={() => playerActions.togglePlay()}
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-media-fg/10 hover:bg-media-fg/20 text-media-fg/95 active:scale-95 transition-all"
                >
                    {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>
            </Tooltip>

            <Tooltip content={`${t('controlBar.nextSentence')}${formatShortcut(nextShortcut)}`} placement="above">
                <button
                    onClick={() => { void playerActions.nextSentence(); }}
                    className={ICON_BUTTON_CLASS}
                >
                    <SkipForward className="w-3.5 h-3.5" />
                </button>
            </Tooltip>
        </div>
    );
}
