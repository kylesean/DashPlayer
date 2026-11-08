import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@/fronted/lib/utils';
import useLayout, { cpW } from '@/fronted/app/stores/layoutStore';
import SideBar from '@/fronted/components/layout/SideBar';

/**
 * 主应用工作区外壳布局：固定展示左侧导航栏，右侧渲染各工具子页面。
 */
const AppShellLayout = () => {
    const screenWidth = useLayout((s) => s.width);
    const changeSideBar = useLayout((s) => s.changeSideBar);
    const isWide = cpW(screenWidth, 'xl');

    // 工作区视图始终显示侧栏，同步布局状态以便标题栏悬浮控制胶囊保持常显。
    useEffect(() => {
        changeSideBar(true);
    }, [changeSideBar]);

    return (
        <div
            className={cn('grid grid-rows-1 h-full w-full')}
            style={{
                gridTemplateColumns: isWide
                    ? '15% 85%'
                    : '65px calc(100% - 65px)',
                gridTemplateRows: '100%',
            }}
        >
            <div className={cn('col-start-1 col-end-2 row-start-1 row-end-2')}>
                <SideBar compact={!isWide} />
            </div>
            <div
                className={cn('p-2.5 pl-1.5')}
                style={{ gridArea: '1 / 2 / -1 / -1' }}
            >
                <div
                    className={cn(
                        'w-full h-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-xs',
                    )}
                >
                    <Outlet />
                </div>
            </div>
        </div>
    );
};

export default AppShellLayout;
