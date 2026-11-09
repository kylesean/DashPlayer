import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/fronted/lib/utils';
import useLayout from '@/fronted/app/stores/layoutStore';
import { useSubtitleScrollState } from '@/fronted/features/player/hooks/useSubtitleScroll';
import { swrApiMutate } from '@/fronted/lib/swr-util';
import { useHotkeys } from 'react-hotkeys-hook';
import useSetting from '@/fronted/features/settings/settingsStore';
import { PanelLeftOpen } from 'lucide-react';
import { Tooltip } from '@astryxdesign/core/Tooltip';

const process = (values: string) =>
    values
        .split(',')
        .map((k) => k.replaceAll(' ', ''))
        .filter((k) => k !== '');

/**
 * 导航侧栏控制开关组件。
 *
 * 遵循「零悬浮干扰与内嵌式操控」交互标准：
 * 彻底移除原先漂浮在右下角、直接遮挡字幕剧本末尾内容的浮动按钮。
 * 将开关收敛至左上角（Top-Left）自然导航位，提供符合现代桌面系统（如 macOS/Arc）的侧栏折叠/展开体验。
 */
export default function ControlButton() {
    const { t } = useTranslation('player');
    const changeSideBar = useLayout((s) => s.changeSideBar);
    const showSideBar = useLayout((s) => s.showSideBar);
    const pauseMeasurement = useSubtitleScrollState((state) => state.pauseMeasurement);
    const fullScreen = useLayout((s) => s.fullScreen);
    const openControlPanelShortcut = useSetting((s) => s.values.get('shortcut.openControlPanel') ?? '');

    useHotkeys(
        process(openControlPanelShortcut),
        () => {
            changeSideBar(!showSideBar);
        },
        [changeSideBar, showSideBar],
    );

    const panelTooltipText = `${showSideBar ? t('controlButton.closePanel') : t('controlButton.openPanel')}${
        openControlPanelShortcut ? ` (${openControlPanelShortcut})` : ''
    }`;

    if (fullScreen) {
        return null;
    }

    return (
        <AnimatePresence>
            {!showSideBar && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9, x: -10 }}
                    transition={{ duration: 0.18 }}
                    className="absolute top-3.5 left-3.5 z-40 pointer-events-auto select-none"
                >
                    <Tooltip content={panelTooltipText} placement="end">
                        <button
                            type="button"
                            onClick={async () => {
                                await swrApiMutate('watch-history/list');
                                pauseMeasurement();
                                changeSideBar(true);
                            }}
                            className={cn(
                                'w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer select-none',
                                'bg-surface/85 hover:bg-surface text-secondary hover:text-primary border border-border/80 backdrop-blur-md shadow-sm',
                                'hover:scale-105 active:scale-95 transition-all duration-150',
                            )}
                            aria-label={t('controlButton.openPanel')}
                        >
                            <PanelLeftOpen className="w-4 h-4" />
                        </button>
                    </Tooltip>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
