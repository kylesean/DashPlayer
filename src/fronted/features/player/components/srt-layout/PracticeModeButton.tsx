import { Mic } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { cn } from '@/fronted/lib/utils';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import useChatPanel from '@/fronted/features/chat/chatStore';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import {
    CAPTION_CARD_BUTTON_CLASS,
    CAPTION_CARD_IDLE_CLASS,
    captionCardActiveClass,
} from '@/fronted/features/player/components/captionCardShell';
import { TOOLBAR_ICON_BUTTON } from '@/fronted/features/player/components/learning-toolbar/toolbarStyles';

/**
 * 跟读/听写练习开关按钮。
 *
 * 打开练习覆盖面板对当前意群做跟读或听写;与整句学习页互斥——打开时先收起学习页,
 * 并暂停播放避免原句声音混进录音。
 *
 * @param variant `capsule`：学习页右下角胶囊里的 24px 正圆；`toolbar`：字幕学习台里的 28px 方形按钮。
 * @returns 练习开关按钮。
 */
export default function PracticeModeButton({ variant = 'capsule' }: { variant?: 'capsule' | 'toolbar' } = {}) {
    const { t } = useI18nTranslation('practice');
    const visible = usePracticePanel((s) => s.visible);

    const handleClick = (): void => {
        const { currentSentence } = usePlayer.getState();
        if (!currentSentence) {
            toast.error(t('panel.noSentence'));
            return;
        }
        const next = !visible;
        // 两个覆盖面板共享同一块区域:打开任一方时收起另一方
        useChatPanel.getState().hideLearning();
        usePracticePanel.getState().setVisible(next);
        if (next) {
            playerActions.pause();
        }
    };

    return (
        <Tooltip content={t('panel.title')} placement="above">
            <button
                type="button"
                onClick={handleClick}
                aria-label={t('panel.title')}
                className={cn(
                    variant === 'toolbar' ? TOOLBAR_ICON_BUTTON : CAPTION_CARD_BUTTON_CLASS,
                    visible ? captionCardActiveClass('emerald') : CAPTION_CARD_IDLE_CLASS
                )}
            >
                <Mic className="w-3.5 h-3.5" />
            </button>
        </Tooltip>
    );
}
