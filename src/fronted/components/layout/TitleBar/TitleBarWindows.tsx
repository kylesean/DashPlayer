import { useCallback } from 'react';
import { cn } from '@/fronted/lib/utils';
import { SWR_KEY, swrMutate } from '@/fronted/lib/swr-util';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { WindowState } from '@/common/types/Types';
import { Minus, X } from 'lucide-react';
import { TitleBarNavigation } from './TitleBarNavigation';
import { TitleBarTitle } from './TitleBarTitle';
import { TitleBarRightNavigation } from './TitleBarRightNavigation';

/**
 * Windows / Linux 标题栏控制属性。
 */
export interface TitleBarWindowsProps {
    /** 是否允许最大化与全屏。 */
    maximizable?: boolean;
    /** 自定义容器类名。 */
    className?: string;
}

const api = backendClient;

/**
 * Windows / Linux 桌面端极简现代窗口控制栏。
 *
 * 遵循现代桌面端统一规范（如 VS Code、Chrome、Linear、Spotify）：
 * 采用实体结构顶栏布局，左侧/中间为拖拽区（双击最大化/还原），
 * 右侧为像素级对齐的极简几何控制组：最小化（—）、最大化/还原（□）与关闭（✕），
 * 提供规范的原生平台级交互与 hover 反馈（关闭按钮红底高亮，最小化/最大化轻微背景提亮）。
 *
 * @param props 标题栏配置入参。
 * @returns 窗口控制栏 JSX 元素。
 */
const TitleBarWindows = ({ maximizable = true, className = '' }: TitleBarWindowsProps) => {
    const { t } = useTranslation('common');

    const { data: windowState } = useSWR<WindowState>(
        SWR_KEY.WINDOW_SIZE,
        async () => api.call('system/window-size'),
    );

    const isMaximized = windowState === 'maximized';

    const handleMinimize = useCallback(async () => {
        await api.call('system/window-size/change', 'minimized');
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, []);

    const handleToggleMaximize = useCallback(async () => {
        if (!maximizable) {
            return;
        }
        if (isMaximized) {
            await api.call('system/window-size/change', 'normal');
        } else {
            await api.call('system/window-size/change', 'maximized');
        }
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, [isMaximized, maximizable]);

    const handleClose = useCallback(async () => {
        await api.call('system/window-size/change', 'closed');
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, []);

    return (
        <div className={cn('w-full h-full flex items-center justify-between select-none', className)}>
            {/* 左侧导航控制（仅在播放器等需要导航时渲染） */}
            <div className="flex items-center h-full pl-[8px] shrink-0">
                <TitleBarNavigation />
            </div>

            {/* 可拖拽标题栏主体，双击响应最大化与还原 */}
            <div
                className="drag flex-1 h-full min-w-0 flex items-center justify-center px-[16px]"
                onDoubleClick={handleToggleMaximize}
            >
                <TitleBarTitle />
            </div>

            {/* 右侧窗口控制按钮组 */}
            <div className="no-drag flex items-center h-full shrink-0">
                <TitleBarRightNavigation />
                <button
                    onClick={handleMinimize}
                    className="inline-flex items-center justify-center w-[44px] h-full text-muted-foreground/80 hover:text-foreground hover:bg-muted/80 active:bg-muted transition-colors cursor-pointer"
                    id="minimize"
                    type="button"
                    aria-label={t('minimize')}
                    title={t('minimize')}
                >
                    <Minus className="w-[14px] h-[14px]" />
                </button>
                <button
                    onClick={handleToggleMaximize}
                    className={cn(
                        'inline-flex items-center justify-center w-[44px] h-full text-muted-foreground/80 hover:text-foreground hover:bg-muted/80 active:bg-muted transition-colors cursor-pointer',
                        !maximizable && 'opacity-40 cursor-not-allowed',
                    )}
                    id="maximize"
                    type="button"
                    disabled={!maximizable}
                    aria-label={isMaximized ? t('restore') : t('maximize')}
                    title={isMaximized ? t('restore') : t('maximize')}
                >
                    {isMaximized ? (
                        <svg className="w-[12px] h-[12px]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                            <rect x="1.5" y="3.5" width="7" height="7" rx="0.5" />
                            <path d="M3.5 3.5V1.5C3.5 1.22 3.72 1 4 1H10.5C10.78 1 11 1.22 11 1.5V8C11 8.28 10.78 8.5 10.5 8.5H8.5" />
                        </svg>
                    ) : (
                        <svg className="w-[12px] h-[12px]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                            <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />
                        </svg>
                    )}
                </button>
                <button
                    onClick={handleClose}
                    className="inline-flex items-center justify-center w-[44px] h-full text-muted-foreground/80 hover:text-on-error hover:bg-error active:bg-error/90 transition-colors cursor-pointer"
                    id="close"
                    type="button"
                    aria-label={t('close')}
                    title={t('close')}
                >
                    <X className="w-[16px] h-[16px]" />
                </button>
            </div>
        </div>
    );
};

export default TitleBarWindows;
