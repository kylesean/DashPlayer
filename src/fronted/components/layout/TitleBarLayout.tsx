import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Center } from '@astryxdesign/core/Center';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import TitleBar from '@/fronted/components/layout/TitleBar/TitleBar';
import { TITLE_BAR_HEIGHT } from '@/fronted/components/layout/TitleBar/titleBarMetrics';
import { useTranslation } from 'react-i18next';
import useLayout from '@/fronted/app/stores/layoutStore';

/**
 * 带有桌面端统一标题栏的顶层路由布局容器。
 *
 * 采用结构化标题栏（非悬浮遮罩）规范：
 * - 顶栏固定占据 32px 实体高度，承载系统原生拖拽、双击最大化与 Windows/Linux 窗口控制（—/□/✕）。
 * - 顶栏不画底部分隔线：那条线会贴在窗口控制按钮下沿，并在浅色/高对比主题下
 *   与下方内容面的圆角边框叠成「丁」字形；内容区的层级由 AppShell 的 elevated
 *   表面自己承担，不需要额外一条 1px 线。
 * - 全屏（fullScreen）状态下顶栏自动收起，视频画面无缝充满整个视口。
 *
 * @returns 包含顶栏与路由子页面的布局 JSX 元素。
 */
const TitleBarLayout: React.FC = () => {
    const { t } = useTranslation('common');
    const fullScreen = useLayout((s) => s.fullScreen);

    return (
        <Layout
            height="fill"
            // padding={0}：LayoutHeader 默认给内层加 spacing-4 的上下内边距，
            // 会把 32px 的标题栏挤出 header，导致窗口控制按钮高度不一、与标题栏错位
            header={
                !fullScreen ? (
                    <LayoutHeader height={TITLE_BAR_HEIGHT} padding={0}>
                        {/* 标题栏高度由 TitleBar 自身固定，外层只负责同高的 header slot；
                            不要再用 h-8 之类的 spacing 工具类，它会跟随主题放大 */}
                        <TitleBar className="w-full" />
                    </LayoutHeader>
                ) : undefined
            }
            content={
                <LayoutContent padding={0} isScrollable={false}>
                    <Suspense fallback={<Center height="fill"><Spinner label={t('loading')} /></Center>}>
                        <div className="w-full h-full relative">
                            <Outlet />
                        </div>
                    </Suspense>
                </LayoutContent>
            }
        />
    );
};

export default TitleBarLayout;
