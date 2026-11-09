import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Center } from '@astryxdesign/core/Center';
import { Spinner } from '@astryxdesign/core/Spinner';
import TitleBar from '@/fronted/components/layout/TitleBar/TitleBar';
import { useTranslation } from 'react-i18next';
import useLayout from '@/fronted/app/stores/layoutStore';

/**
 * 带有桌面端统一标题栏的顶层路由布局容器。
 *
 * 采用结构化标题栏（非悬浮遮罩）规范：
 * - 顶栏固定占据 32px 实体高度，承载系统原生拖拽、双击最大化与 Windows/Linux 窗口控制（—/□/✕）。
 * - 页面业务内容（播放器舞台、伴读剧本流、设置面板等）在顶栏下方渲染，从物理空间上彻底杜绝与窗口控制按钮的重叠遮挡。
 * - 全屏（fullScreen）状态下顶栏自动收起，视频画面无缝充满整个视口。
 *
 * @returns 包含顶栏与路由子页面的布局 JSX 元素。
 */
const TitleBarLayout: React.FC = () => {
    const { t } = useTranslation('common');
    const fullScreen = useLayout((s) => s.fullScreen);

    return (
        <div className="w-full h-screen bg-body text-primary flex flex-col overflow-hidden select-none">
            {!fullScreen && (
                <div className="w-full h-8 shrink-0 bg-background/90 backdrop-blur-md border-b border-border/40 flex items-center z-50">
                    <TitleBar className="w-full h-full" />
                </div>
            )}
            <Suspense fallback={<Center height="fill"><Spinner label={t('loading')} /></Center>}>
                <div className="flex-1 h-0 w-full relative">
                    <Outlet />
                </div>
            </Suspense>
        </div>
    );
};

export default TitleBarLayout;
