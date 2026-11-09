import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/fronted/lib/utils';
import { SWR_KEY, swrMutate } from '@/fronted/lib/swr-util';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { WindowState } from '@/common/types/Types';
import { Minus, X } from 'lucide-react';
import useLayout from '@/fronted/app/stores/layoutStore';

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
 * 彻底废除将 macOS 红黄绿圆点粗暴移植到右上角的违和悬浮胶囊设计，
 * 采用像素级对齐的极简几何控制组：最小化（—）、最大化/还原（□）与关闭（✕），
 * 提供规范的原生平台级交互与 hover 反馈（关闭按钮红底高亮，最小化/最大化轻微背景提亮）。
 *
 * @param props 标题栏配置入参。
 * @returns 窗口控制栏 JSX 元素。
 */
const TitleBarWindows = ({ maximizable = true, className = '' }: TitleBarWindowsProps) => {
    const { t } = useTranslation('common');
    const fullScreen = useLayout((s) => s.fullScreen);

    const { data: windowState } = useSWR<WindowState>(
        SWR_KEY.WINDOW_SIZE,
        async () => api.call('system/window-size'),
    );

    const isFullscreen = windowState === 'fullscreen' || fullScreen;
    const isMaximized = windowState === 'maximized';

    // 全屏模式下仅当鼠标悬停在屏幕右上角 36px 高、180px 宽的边缘热区时才浮现控制按钮，避免打扰视听
    const [mouseNearTopRight, setMouseNearTopRight] = useState(false);

    useEffect(() => {
        if (!isFullscreen) {
            return;
        }

        const handleMouseMove = (e: MouseEvent) => {
            const isNear = e.clientY <= 36 && e.clientX >= window.innerWidth - 180;
            setMouseNearTopRight(isNear);
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [isFullscreen]);

    const isControlsVisible = !isFullscreen || mouseNearTopRight;

    const handleMinimize = useCallback(async () => {
        await api.call('system/window-size/change', 'minimized');
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, []);

    const handleToggleMaximize = useCallback(async () => {
        if (!maximizable) {
            return;
        }
        if (isMaximized || isFullscreen) {
            await api.call('system/window-size/change', 'normal');
        } else {
            await api.call('system/window-size/change', 'maximized');
        }
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, [isFullscreen, isMaximized, maximizable]);

    const handleClose = useCallback(async () => {
        await api.call('system/window-size/change', 'closed');
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, []);

    return (
        <div
            className={cn(
                'absolute top-0 right-0 z-50 flex items-center justify-end select-none pointer-events-auto',
                !isControlsVisible && 'opacity-0 pointer-events-none transition-opacity duration-200',
                className,
            )}
        >
            {/* 当父级指定了通顶标题栏（例如带有 w-full）时，左侧留白区域响应双击最大化与拖拽窗口 */}
            <div
                className="drag flex-1 h-full min-w-0"
                onDoubleClick={handleToggleMaximize}
            />
            <div className="no-drag flex items-center h-8 shrink-0">
                <button
                    onClick={handleMinimize}
                    className="inline-flex items-center justify-center w-11 h-8 text-muted-foreground/80 hover:text-foreground hover:bg-muted/80 active:bg-muted transition-colors cursor-pointer"
                    id="minimize"
                    type="button"
                    aria-label={t('minimize')}
                    title={t('minimize')}
                >
                    <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={handleToggleMaximize}
                    className={cn(
                        'inline-flex items-center justify-center w-11 h-8 text-muted-foreground/80 hover:text-foreground hover:bg-muted/80 active:bg-muted transition-colors cursor-pointer',
                        !maximizable && 'opacity-40 cursor-not-allowed',
                    )}
                    id="maximize"
                    type="button"
                    disabled={!maximizable}
                    aria-label={isMaximized ? t('restore') : t('maximize')}
                    title={isMaximized ? t('restore') : t('maximize')}
                >
                    {isMaximized ? (
                        // 还原图标：双层线框方块
                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                            <rect x="1.5" y="3.5" width="7" height="7" rx="0.5" />
                            <path d="M3.5 3.5V1.5C3.5 1.22 3.72 1 4 1H10.5C10.78 1 11 1.22 11 1.5V8C11 8.28 10.78 8.5 10.5 8.5H8.5" />
                        </svg>
                    ) : (
                        // 最大化图标：单层线框方块
                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                            <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />
                        </svg>
                    )}
                </button>
                <button
                    onClick={handleClose}
                    className="inline-flex items-center justify-center w-11 h-8 text-muted-foreground/80 hover:text-white hover:bg-red-600 dark:hover:bg-red-600 active:bg-red-700 transition-colors cursor-pointer"
                    id="close"
                    type="button"
                    aria-label={t('close')}
                    title={t('close')}
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export default TitleBarWindows;
