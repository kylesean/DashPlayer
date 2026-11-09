import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppShell } from '@astryxdesign/core/AppShell';
import useLayout, { cpW } from '@/fronted/app/stores/layoutStore';
import SideBar from '@/fronted/components/layout/SideBar';

/**
 * 主应用工作区外壳：按 Astryx `shell-side-nav` 模板组织页面骨架。
 *
 * - 根布局用 `AppShell variant="elevated"`，由它提供 wash 导航区、
 *   elevated 内容表面、skip link 与唯一的 <main> landmark；不再手写
 *   `rounded-2xl border`——那条 1px 线会和 32px 系统标题栏、内层
 *   LayoutPanel 分隔线叠出难看的「丁」字形。
 * - 子页面（设置中心等）在 AppShell 的 children 里用 `Layout` 做主从分栏，
 *   符合 AppShell 文档「子页面布局用 Layout」的分工。
 * - 桌面 Electron 窗口始终内联展示侧栏，用 `mobileNav={{breakpoint:'none'}}`
 *   关掉移动抽屉，避免窄窗口时导航整个消失。
 * - 设置页默认把主侧栏收成图标轨（避免 56px 主轨 + 240px 设置轨之外再叠一条宽轨），
 *   但折叠按钮仍然可用来展开；离开设置页后恢复全局偏好。
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

    /** 记录用户在哪一个设置页主动展开过主侧栏；离开设置页后自然失效。 */
    const [expandedSettingsPath, setExpandedSettingsPath] = React.useState<string | null>(null);
    const settingsRailExpanded = isSettings && expandedSettingsPath === location.pathname;

    const compact = !isWide || (isSettings ? !settingsRailExpanded : sidebarCollapsed);
    const onToggleCollapse = isSettings
        ? () => setExpandedSettingsPath((current) => (
            current === location.pathname ? null : location.pathname
        ))
        : undefined;

    // 工作区视图始终显示侧栏
    useEffect(() => {
        changeSideBar(true);
    }, [changeSideBar]);

    return (
        <AppShell
            variant="elevated"
            contentPadding={0}
            mobileNav={{ breakpoint: 'none' }}
            style={{ height: '100%', minHeight: 0, width: '100%' }}
            sideNav={(
                <SideBar
                    compact={compact}
                    onToggleCollapse={onToggleCollapse}
                    collapseDisabled={!isWide}
                />
            )}
        >
            <Outlet />
        </AppShell>
    );
};

export default AppShellLayout;
