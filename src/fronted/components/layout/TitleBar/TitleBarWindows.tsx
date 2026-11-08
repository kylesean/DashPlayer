import React from 'react';
import { cn } from '@/fronted/lib/utils';
import './TitleBarWindows.css';
import useLayout from '@/fronted/app/stores/layoutStore';
import { SWR_KEY, swrMutate } from '@/fronted/lib/swr-util';
import useTrafficLightsVisibility from './useTrafficLightsVisibility';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { WindowState } from '@/common/types/Types';
import { Maximize2, Minimize2 } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/fronted/components/ui/tooltip';

/**
 * Windows / Linux 标题栏属性。
 */
export interface TitleBarWindowsProps {
    /** 是否允许最大化与全屏。 */
    maximizable?: boolean;
    /** 自定义容器类名。 */
    className?: string;
}

const api = backendClient;

/**
 * Windows / Linux 悬浮胶囊窗口控制栏。
 *
 * 保留红黄绿三色交通灯质感与胶囊外壳，提供明确的最小化、最大化/还原、显式全屏切换与关闭按钮。
 */
const TitleBarWindows = ({ maximizable = true, className = '' }: TitleBarWindowsProps) => {
    const { t } = useTranslation('common');
    const showSideBar = useLayout((s) => s.showSideBar);
    const { visible, onMouseEnter, onMouseLeave, onMouseMove } = useTrafficLightsVisibility(showSideBar);

    const { data: windowState } = useSWR<WindowState>(
        SWR_KEY.WINDOW_SIZE,
        async () => api.call('system/window-size'),
    );

    const isFullscreen = windowState === 'fullscreen';
    const isMaximized = windowState === 'maximized';

    const handleMinimize = React.useCallback(async () => {
        await api.call('system/window-size/change', 'minimized');
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, []);

    const handleToggleMaximize = React.useCallback(async () => {
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

    const handleToggleFullscreen = React.useCallback(async () => {
        if (!maximizable) {
            return;
        }
        if (isFullscreen) {
            await api.call('system/window-size/change', 'normal');
        } else {
            await api.call('system/window-size/change', 'fullscreen');
        }
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, [isFullscreen, maximizable]);

    const handleClose = React.useCallback(async () => {
        await api.call('system/window-size/change', 'closed');
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, []);

    return (
        <div
            className={cn(
                'absolute top-0 right-0 z-50 select-none drag flex items-center justify-end pr-4 pt-4',
                className,
            )}
        >
            <div
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                onMouseMove={onMouseMove}
                className="no-drag flex items-center justify-center cursor-default"
            >
                <div
                    className={cn(
                        'flex justify-center items-center px-2.5 py-1.5 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/5 dark:border-white/10 shadow-xs backdrop-blur-md traffic-lights transition-all duration-200',
                        !visible && 'opacity-0 pointer-events-none',
                    )}
                >
                    <button
                        onClick={handleMinimize}
                        className="traffic-light traffic-light-minimize"
                        id="minimize"
                        type="button"
                        aria-label={t('minimize')}
                        title={t('minimize')}
                    />
                    <button
                        onClick={handleToggleMaximize}
                        className={cn('traffic-light traffic-light-maximize', !maximizable && 'opacity-50 cursor-not-allowed')}
                        id="maximize"
                        type="button"
                        disabled={!maximizable}
                        aria-label={isMaximized ? t('restore') : t('maximize')}
                        title={isMaximized ? t('restore') : t('maximize')}
                    />
                    {maximizable ? (
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={handleToggleFullscreen}
                                        className={cn(
                                            'no-drag inline-flex items-center justify-center w-3 h-3 mr-[5px] text-muted-foreground/70 hover:text-foreground transition-colors',
                                            isFullscreen && 'text-primary',
                                        )}
                                        type="button"
                                        aria-label={isFullscreen ? t('exitFullScreen') : t('enterFullScreen')}
                                    >
                                        {isFullscreen ? (
                                            <Minimize2 className="w-2.5 h-2.5" />
                                        ) : (
                                            <Maximize2 className="w-2.5 h-2.5" />
                                        )}
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                    {isFullscreen ? t('exitFullScreen') : t('enterFullScreen')}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : null}
                    <button
                        onClick={handleClose}
                        className="traffic-light traffic-light-close"
                        id="close"
                        type="button"
                        aria-label={t('close')}
                        title={t('close')}
                    />
                </div>
            </div>
        </div>
    );
};

export default TitleBarWindows;
