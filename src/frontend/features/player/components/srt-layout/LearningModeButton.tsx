import { GraduationCap } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { cn } from '@/frontend/lib/utils';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import useChatPanel from '@/frontend/features/chat/chatStore';
import useSetting from '@/frontend/features/settings/settingsStore';
import { exitOverlayView } from '@/frontend/features/player/lib/player-view-controller';
import {
    CAPTION_CARD_BUTTON_CLASS,
    CAPTION_CARD_IDLE_CLASS,
    captionCardActiveClass,
} from '@/frontend/features/player/components/captionCardShell';
import { TOOLBAR_ICON_BUTTON } from '@/frontend/features/player/components/learning-toolbar/toolbarStyles';

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
    // 只订阅自身字段：视图互斥由统一写入点保证，因此 learningVisible 为真
    // 就等价于「学习页是实际可见视图」，不需要在 selector 里跨 store 推导
    // （跨 store 推导还会漏订阅，别的 store 变化时按钮不会刷新）。
    const active = useChatPanel((s) => s.learningVisible);
    const shortcut = useSetting((s) => s.setting('shortcut.aiChat')) ?? '';
    const label = active ? t('learning.backToPlayer') : t('learning.title');
    const tooltipContent = `${label}${shortcut ? ` (${shortcut})` : ''}`;

    /**
     * 开关学习页：与快捷键走同一入口，进入失败（如当前没有可学习的字幕句）直接提示原因。
     *
     * 关闭动作仍然只隐藏、不销毁会话，后台生成不中断。
     */
    const handleClick = (): void => {
        // 已打开时直接走统一入口收起（同时确保竞争视图也归位），
        // 未打开时由 chatStore 负责暂停播放并建会话。
        if (active) {
            // 用 exitOverlayView 而不是 toggle：音频文件原来在播客模式，
            // 退出学习页必须回到播客，否则会看到没有画面的黑屏舞台。
            exitOverlayView();
            return;
        }
        void useChatPanel.getState().createFromCurrent().catch((error) => {
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
                    active ? captionCardActiveClass('emerald') : CAPTION_CARD_IDLE_CLASS
                )}
            >
                <GraduationCap className="w-4 h-4" />
            </button>
        </Tooltip>
    );
}
