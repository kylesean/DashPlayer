import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';

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

/** 分段项的形状：贴近原三按钮的尺寸与字重，只把交互语义交给 SegmentedControl。 */
const SEGMENT_SHAPE =
    '[&_[role=radio]]:text-sm! [&_[role=radio]]:font-medium! [&_[role=radio]]:px-2.5! [&_[role=radio]]:rounded-md!';

/** 两套宿主底色下的分段项配色，覆盖 Astryx 默认主题色。 */
const SEGMENT_TONE: Record<ToolbarTone, string> = {
    panel:
        '[&_[role=radio]]:text-muted-foreground! [&_[role=radio]:hover]:text-foreground! [&_[role=radio][aria-checked=true]]:bg-background! [&_[role=radio][aria-checked=true]]:text-foreground!',
    overlay:
        '[&_[role=radio]]:text-media-fg/70! [&_[role=radio]:hover]:text-media-fg! [&_[role=radio][aria-checked=true]]:bg-media-fg/20! [&_[role=radio][aria-checked=true]]:text-media-fg!',
};

/**
 * 字幕轨道三段单选：EN / 中 / 双语。
 *
 * 只做三档常用预设，细粒度开关（自带中文、整句显示、侧栏跟随等）在设置弹层里；
 * 三档用 SegmentedControl 表达单选关系，快捷键 E / C / B 仍可用。
 *
 * 三档都未命中时（例如用户用快捷键把英文与中文都关掉）value 传空串，
 * 此时没有分段被选中，保持与“全部关闭”的真实状态一致。
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
    const selectedTrack = isEnOnly ? 'english' : isCnOnly ? 'chinese' : isBilingual ? 'bilingual' : '';
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

    const handleChange = (next: string) => {
        if (next === 'english') {
            showEnglishOnly();
        } else if (next === 'chinese') {
            showChineseOnly();
        } else if (next === 'bilingual') {
            showBilingual();
        }
    };

    return (
        <SegmentedControl
            label={t('controlBar.tracksLabel')}
            value={selectedTrack}
            onChange={handleChange}
            size={tone === 'overlay' ? 'md' : 'sm'}
            className={cn(
                TOOLBAR_SEGMENTED,
                style.segmented,
                tone === 'overlay' ? 'h-8 bg-media-fg/10!' : 'bg-muted/60!',
                SEGMENT_SHAPE,
                SEGMENT_TONE[tone],
                className,
            )}
        >
            <Tooltip content={`${t('controlBar.tracksTooltipEnglish')}${formatShortcut(enShortcut)}`} placement="above">
                <SegmentedControlItem value="english" label={t('controlBar.tracksEnglish')} />
            </Tooltip>
            <Tooltip content={`${t('controlBar.tracksTooltipChinese')}${formatShortcut(cnShortcut)}`} placement="above">
                <SegmentedControlItem value="chinese" label={t('controlBar.tracksChinese')} />
            </Tooltip>
            <Tooltip content={`${t('controlBar.tracksTooltipBilingual')}${formatShortcut(bilingualShortcut)}`} placement="above">
                <SegmentedControlItem value="bilingual" label={t('controlBar.tracksBilingual')} />
            </Tooltip>
        </SegmentedControl>
    );
}
