import React from 'react';
import { cn } from '@/fronted/lib/utils';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import { SWR_KEY, swrMutate } from '@/fronted/lib/swr-util';

/**
 * macOS 自定义标题栏容器。
 *
 * 保留窗口左上角 80px 原生交通灯预留区域（避免拖拽事件冲突），并在可拖拽区域双击时执行窗口 Zoom 缩放切换。
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
        <div className={cn('w-full h-10 absolute top-0 z-50 flex pointer-events-none')}>
            <div className={cn('no-drag w-20 h-full pointer-events-auto')} />
            <div
                className={cn('drag flex-1 h-full pointer-events-auto')}
                onDoubleClick={handleDoubleClick}
            />
        </div>
    );
};

export default TitleBarMac;
