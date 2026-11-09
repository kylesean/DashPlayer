import { SquareDashedBottom } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import useLayout from '@/fronted/app/stores/layoutStore';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { DARK_BAR_BUTTON_HOVER } from '@/fronted/features/player/components/PlaybackGlobalControls';

/** 带文字/徽章的按钮：与视频控制条同一行的图标按钮同高同圆角。 */
const TEXT_BUTTON_CLASS =
    'flex items-center gap-1 h-8 px-2 rounded-lg text-xs font-medium leading-none transition-colors shrink-0';

/**
 * 硬字幕遮挡开关：视频控制条上的一键开关。
 *
 * 作用对象是“画面”而不是“句子”，所以留在视频条，不放进字幕学习台。
 * 这里只负责开与关；贴片的位置与大小靠画面里直接拖拽（见 HardsubMask），不挂二级弹窗。
 * 播客模式不看画面，遮挡无意义，直接不渲染。
 *
 * 开启态用中性白底而不是彩色：控制条上已经有绿（训练）一种语义色，
 * 再添一种色会让“这个按钮是开着还是被禁用”变成要辨色的谜题。
 *
 * 文字在 lg 以下隐藏：窄窗时多这一截文字会把最右的图标挤出可视区；
 * 隐藏后无障碍名称由 aria-label 提供，视觉用户靠 tooltip 与图标认。
 */
export default function HardsubMaskButton() {
    const { t } = useI18nTranslation('player');
    const maskOn = usePlayerUi((s) => s.hardsubMaskOn);
    const toggleMask = usePlayerUi((s) => s.toggleHardsubMask);
    const podcastMode = useLayout((s) => s.podcastMode);

    if (podcastMode) {
        return null;
    }

    return (
        <Tooltip content={t('hardsubMask.label')} placement="above">
            <button
                onClick={toggleMask}
                aria-pressed={maskOn}
                aria-label={t('hardsubMask.label')}
                className={cn(
                    TEXT_BUTTON_CLASS,
                    maskOn
                        ? 'bg-white/20 text-white ring-1 ring-white/30'
                        : cn('text-white/80', DARK_BAR_BUTTON_HOVER)
                )}
            >
                <SquareDashedBottom className="w-3.5 h-3.5" />
                <span className="font-sans hidden lg:inline">{t('hardsubMask.label')}</span>
            </button>
        </Tooltip>
    );
}
