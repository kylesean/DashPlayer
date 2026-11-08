import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import React from 'react';
import { Layout, LayoutContent, LayoutPanel } from '@astryxdesign/core/Layout';
import useLayout, { cpW } from '@/fronted/app/stores/layoutStore';
import SideBar from '@/fronted/components/layout/SideBar';

/**
 * 主应用工作区外壳布局：固定展示左侧导航栏，右侧渲染各工具子页面。
 *
 * 基于 Astryx Layout 原语构建，支持根据宽度自适应宽栏/紧凑栏切换。
 *
 * @returns 工作区外壳 JSX 元素。
 */
const AppShellLayout: React.FC = () => {
    const screenWidth = useLayout((s) => s.width);
    const changeSideBar = useLayout((s) => s.changeSideBar);
    const isWide = cpW(screenWidth, 'xl');

    // 工作区视图始终显示侧栏，同步布局状态以便标题栏悬浮控制胶囊保持常显。
    useEffect(() => {
        changeSideBar(true);
    }, [changeSideBar]);

    return (
        <Layout
            height="fill"
            start={
                <LayoutPanel
                    width={isWide ? 220 : 64}
                    isScrollable={false}
                    hasDivider
                    padding={2}
                >
                    <SideBar compact={!isWide} />
                </LayoutPanel>
            }
            content={
                <LayoutContent padding={2} isScrollable={false}>
                    <div className="w-full h-full rounded-2xl border border-border/80 bg-background overflow-hidden shadow-xs">
                        <Outlet />
                    </div>
                </LayoutContent>
            }
        />
    );
};

export default AppShellLayout;
