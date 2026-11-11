import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';

import { cn } from '@/fronted/lib/utils';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { useSourceChineseAvailability } from '@/fronted/features/player/hooks/useSourceChineseAvailability';
import useSetting from '@/fronted/features/settings/settingsStore';
import { formatShortcut } from '@/fronted/features/player/components/formatShortcut';
import {
    TOOLBAR_SEGMENTED,
    TOOLBAR_TONE,
    type ToolbarTone,
} from './toolbarStyles';

const SEGMENT_CLASS = 'rounded-md px-2.5 py-1 text-sm font-medium transition-colors cursor-pointer';

/**
 * 字幕轨道三段开关：EN / 中 / 双语。
 *
 * 只做三档常用预设，细粒度开关（自带中文、整句显示、侧栏跟随等）在设置弹层里；
 * 三个按钮都直接把结果摆出来，不再套一层菜单。快捷键 E / C / B 仍可用。
 *
 * @param tone 宿主底色：字幕面板或视频画面深色条。
 * @param className 额外样式。
 */
export default function SubtitleTrackSegmented({
    tone,
    className,
}: {
    tone: ToolbarTone;
    className?: string;
}) {
    const { t } = useI18nTranslation('player');
    const showEn = usePlayerUi((s) => s.showEn);
    const showCn = usePlayerUi((s) => s.showCn);
    const showSourceZh = usePlayerUi((s) => s.showSourceZh);
    const changeShowEn = usePlayerUi((s) => s.changeShowEn);
    const changeShowCn = usePlayerUi((s) => s.changeShowCn);
    const changeShowSourceZh = usePlayerUi((s) => s.changeShowSourceZh);
    const sourceZhAvailable = useSourceChineseAvailability();
    const enShortcut = useSetting((s) => s.setting('shortcut.toggleEnglishDisplay'));
    const cnShortcut = useSetting((s) => s.setting('shortcut.toggleChineseDisplay'));
    const bilingualShortcut = useSetting((s) => s.setting('shortcut.toggleBilingualDisplay'));

    // 源字幕中文只有在字幕文件真的带中文时才算法一条可见轨道；否则会出现
    // “双语”已选中、画面上却只有英文的假状态。
    const sourceZhVisible = showSourceZh && sourceZhAvailable;
    const isEnOnly = showEn && !showCn && !sourceZhVisible;
    const isCnOnly = !showEn && (showCn || sourceZhVisible);
    const isBilingual = showEn && (showCn || sourceZhVisible);
    const style = TOOLBAR_TONE[tone];

    /** 只留英文：关掉两路中文。 */
    const showEnglishOnly = () => {
        if (!showEn) changeShowEn();
        if (showCn) changeShowCn();
        if (showSourceZh) changeShowSourceZh();
    };
    /**
     * 只留中文：英文关掉。
     *
     * 判断必须用 `sourceZhVisible` 而不是原始的 `showSourceZh`：字幕文件不带中文时，
     * `showSourceZh` 仍可能是 true，但画面上一行中文都没有。此时若按原始值跳过
     * `changeShowCn()`，三档会同时不选中且点「中」毫无反应——用户被困在空白字幕里。
     */
    const showChineseOnly = () => {
        if (showEn) changeShowEn();
        if (!showCn && !sourceZhVisible) changeShowCn();
    };
    /** 双语：英文 + AI 翻译都打开。 */
    const showBilingual = () => {
        if (!showEn) changeShowEn();
        if (!showCn) changeShowCn();
    };

    return (
        <div className={cn(TOOLBAR_SEGMENTED, style.segmented, tone === 'overlay' && 'h-8', className)}>
            <Tooltip content={`${t('controlBar.tracksTooltipEnglish')}${formatShortcut(enShortcut)}`} placement="above">
                <button
                    type="button"
                    onClick={showEnglishOnly}
                    aria-pressed={isEnOnly}
                    className={cn(SEGMENT_CLASS, tone === 'overlay' ? 'py-1' : 'py-0.5', isEnOnly ? style.segmentActive : style.segmentIdle)}
                >
                    {t('controlBar.tracksEnglish')}
                </button>
            </Tooltip>
            <Tooltip content={`${t('controlBar.tracksTooltipChinese')}${formatShortcut(cnShortcut)}`} placement="above">
                <button
                    type="button"
                    onClick={showChineseOnly}
                    aria-pressed={isCnOnly}
                    className={cn(SEGMENT_CLASS, tone === 'overlay' ? 'py-1' : 'py-0.5', isCnOnly ? style.segmentActive : style.segmentIdle)}
                >
                    {t('controlBar.tracksChinese')}
                </button>
            </Tooltip>
            <Tooltip content={`${t('controlBar.tracksTooltipBilingual')}${formatShortcut(bilingualShortcut)}`} placement="above">
                <button
                    type="button"
                    onClick={showBilingual}
                    aria-pressed={isBilingual}
                    className={cn(SEGMENT_CLASS, tone === 'overlay' ? 'py-1' : 'py-0.5', isBilingual ? style.segmentActive : style.segmentIdle)}
                >
                    {t('controlBar.tracksBilingual')}
                </button>
            </Tooltip>
        </div>
    );
}
