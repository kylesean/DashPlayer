import { GraduationCap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { cn } from '@/fronted/lib/utils';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import useChatPanel from '@/fronted/features/chat/chatStore';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import {
    CAPTION_CARD_BUTTON_CLASS,
    CAPTION_CARD_IDLE_CLASS,
    captionCardActiveClass,
} from '@/fronted/features/player/components/captionCardShell';
import { TOOLBAR_ICON_BUTTON } from '@/fronted/features/player/components/learning-toolbar/toolbarStyles';

/**
 * 整句学习开关按钮。
 *
 * 与「进入学习页」的快捷键是同一个动作：未打开时按当前字幕句进入学习页，
 * 已打开时只隐藏学习页、保留会话，后台生成不中断。
 *
 * @param variant `capsule`：学习界面右下角胶囊里的 24px 正圆；`toolbar`：字幕学习台里的 28px 方形按钮。
 * @returns 整句学习开关按钮。
 */
export default function LearningModeButton({ variant = 'capsule' }: { variant?: 'capsule' | 'toolbar' } = {}) {
    const { t } = useI18nTranslation('common');
    const learningVisible = useChatPanel((s) => s.learningVisible);
    const shortcut = useSetting((s) => s.setting('shortcut.aiChat')) ?? '';
    const label = learningVisible ? t('learning.backToPlayer') : t('learning.title');
    const tooltipContent = `${label}${shortcut ? ` (${shortcut})` : ''}`;

    /**
     * 开关学习页：与快捷键走同一入口，进入失败（如当前没有可学习的字幕句）直接提示原因。
     */
    const handleClick = (): void => {
        // 两个覆盖面板共享同一块区域:打开学习页时收起练习面板
        usePracticePanel.getState().setVisible(false);
        void useChatPanel.getState().toggleLearning().catch((error) => {
            toast.error(error instanceof Error ? error.message : String(error));
        });
    };

    return (
        <Tooltip content={tooltipContent} placement="above">
            <button
                type="button"
                onClick={handleClick}
                aria-label={label}
                className={cn(
                    variant === 'toolbar' ? TOOLBAR_ICON_BUTTON : CAPTION_CARD_BUTTON_CLASS,
                    learningVisible ? captionCardActiveClass('emerald') : CAPTION_CARD_IDLE_CLASS
                )}
            >
                <GraduationCap className="w-3.5 h-3.5" />
            </button>
        </Tooltip>
    );
}
