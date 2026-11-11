import React from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PanelRight } from 'lucide-react';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import useLayout from '@/fronted/app/stores/layoutStore';
import { cn } from '@/fronted/lib/utils';

const InnerRightNavigation: React.FC = () => {
    const location = useLocation();
    const { t: tPlayer } = useTranslation('player');
    const showTranscript = useLayout((s) => s.showTranscript);
    const toggleTranscript = useLayout((s) => s.toggleTranscript);

    const isPlayer = location.pathname.startsWith('/player');

    if (!isPlayer) {
        return null;
    }

    return (
        <div className="no-drag flex items-center h-full shrink-0 mr-[6px]">
            <Tooltip
                content={
                    showTranscript
                        ? tPlayer('controlButton.closeTranscript', { defaultValue: '收起字幕文稿' })
                        : tPlayer('controlButton.openTranscript', { defaultValue: '展开字幕文稿' })
                }
                placement="below"
            >
                <button
                    type="button"
                    onClick={toggleTranscript}
                    className={cn(
                        'inline-flex items-center justify-center w-[24px] h-[24px] rounded-md cursor-pointer select-none',
                        showTranscript
                            ? 'text-accent bg-accent/15 hover:bg-accent/25'
                            : 'text-muted-foreground/80 hover:text-foreground hover:bg-muted/70 active:bg-muted',
                        'transition-colors',
                    )}
                    aria-label={
                        showTranscript
                            ? tPlayer('controlButton.closeTranscript', { defaultValue: '收起字幕文稿' })
                            : tPlayer('controlButton.openTranscript', { defaultValue: '展开字幕文稿' })
                    }
                >
                    <PanelRight className="w-[14px] h-[14px]" />
                </button>
            </Tooltip>
        </div>
    );
};

/**
 * 桌面顶栏右上角辅助面板（字幕文稿）控制组。
 *
 * 遵循现代桌面专业应用（VS Code / Safari / Final Cut）的空间认知规范：
 * 右侧面板的开关置于顶栏右上角（靠近 Windows 控制按钮或 macOS 窗口右上角），
 * 与左侧主导航形成完美的左右对称映射。
 */
export const TitleBarRightNavigation: React.FC = () => {
    const inRouter = useInRouterContext();
    if (!inRouter) {
        return null;
    }
    return <InnerRightNavigation />;
};

export default TitleBarRightNavigation;
