import React from 'react';
import { cn } from '@/frontend/lib/utils';
import { backendClient } from '@/frontend/infrastructure/electron/backendClient';
import { SWR_KEY, swrMutate } from '@/frontend/lib/swr-util';
import { TitleBarNavigation } from './TitleBarNavigation';
import { TitleBarTitle } from './TitleBarTitle';
import { TitleBarRightNavigation } from './TitleBarRightNavigation';

/**
 * macOS 标题栏容器。
 *
 * 保留窗口左上角 80px 原生交通灯预留区域（避免拖拽事件冲突），并在其后承载播放导航控件，
 * 可拖拽区域居中展示当前播放视频标题，双击时执行窗口 Zoom 缩放切换。
 *
 * @returns macOS 顶栏容器 JSX 元素。
 */
const TitleBarMac = () => {
    const handleDoubleClick = React.useCallback(async () => {
        const windowState = await backendClient.call('system/window-size');
        if (windowState === 'maximized') {
            await backendClient.call('system/window-size/change', 'normal');
        } else {
            await backendClient.call('system/window-size/change', 'maximized');
        }
        await swrMutate(SWR_KEY.WINDOW_SIZE);
    }, []);

    return (
        <div className={cn('w-full h-full flex items-center justify-between select-none')}>
            {/* macOS 原生交通灯预留区域（80px） + 导航控制 */}
            <div className="flex items-center h-full shrink-0">
                <div className={cn('no-drag w-[80px] h-full shrink-0')} />
                <TitleBarNavigation />
            </div>
            <div
                className={cn('drag flex-1 h-full min-w-0 flex items-center justify-center px-[16px]')}
                onDoubleClick={handleDoubleClick}
            >
                <TitleBarTitle />
            </div>
            {/* 右侧面板控制及与交通灯平衡的占位 */}
            <div className="flex items-center justify-end w-[80px] h-full pr-[8px] shrink-0">
                <TitleBarRightNavigation />
            </div>
        </div>
    );
};

export default TitleBarMac;
