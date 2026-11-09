import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Layout, LayoutContent, LayoutPanel } from '@astryxdesign/core/Layout';
import useLayout, { cpW } from '@/fronted/app/stores/layoutStore';
import SideBar from '@/fronted/components/layout/SideBar';

/**
 * 主应用工作区外壳布局：固定展示左侧导航栏，右侧渲染各工具子页面。
 *
 * 遵循工作区导航规范：
 * - 响应全局 sidebarCollapsed 紧凑折叠状态（56px 图标轨 vs 208px 完整菜单）；
 * - 在设置页（/settings）这类自带主从二级分栏（Master-Detail）的模块中，主侧栏自动紧凑化为 56px 图标 Rail，
 *   释放横向视觉空间，避免“主侧栏 + 设置子侧栏”两个宽栏并排挤压。
 *
 * @returns 工作区外壳 JSX 元素。
 */
const AppShellLayout: React.FC = () => {
    const location = useLocation();
    const screenWidth = useLayout((s) => s.width);
    const changeSideBar = useLayout((s) => s.changeSideBar);
    const sidebarCollapsed = useLayout((s) => s.sidebarCollapsed);
    const isWide = cpW(screenWidth, 'xl');
    const isSettings = location.pathname.startsWith('/settings');
    const compact = !isWide || isSettings || sidebarCollapsed;

    // 工作区视图始终显示侧栏
    useEffect(() => {
        changeSideBar(true);
    }, [changeSideBar]);

    return (
        <Layout
            height="fill"
            start={
                <LayoutPanel
                    width={compact ? 56 : 208}
                    isScrollable={false}
                    hasDivider
                    padding={1.5}
                >
                    <SideBar compact={compact} />
                </LayoutPanel>
            }
            content={
                <LayoutContent padding={1.5} isScrollable={false}>
                    <div className="w-full h-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-xs">
                        <Outlet />
                    </div>
                </LayoutContent>
            }
        />
    );
};

export default AppShellLayout;
