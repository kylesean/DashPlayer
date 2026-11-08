import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import React from 'react';
import { Center } from '@astryxdesign/core/Center';
import { Spinner } from '@astryxdesign/core/Spinner';
import TitleBar from '@/fronted/components/layout/TitleBar/TitleBar';
import { useTranslation } from 'react-i18next';

/**
 * 带有桌面端自定义标题栏的顶层路由布局容器。
 *
 * 基于 Astryx 令牌与布局原语构建。
 */
const TitleBarLayout: React.FC = () => {
    const { t } = useTranslation('common');
    return (
        <div className="w-full h-screen bg-body text-primary flex flex-col overflow-hidden select-none">
            <TitleBar className="" />
            <Suspense fallback={<Center height="fill"><Spinner label={t('loading')} /></Center>}>
                <div className="flex-1 h-0 w-full">
                    <Outlet />
                </div>
            </Suspense>
        </div>
    );
};

export default TitleBarLayout;
