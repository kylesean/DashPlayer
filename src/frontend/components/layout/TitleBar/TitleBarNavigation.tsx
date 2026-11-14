import React from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, PanelLeft } from 'lucide-react';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import useLayout from '@/frontend/app/stores/layoutStore';
import { fileBrowserApi } from '@/frontend/features/file-browser/fileBrowserApi';
import { swrApiMutate } from '@/frontend/lib/swr-util';
import useSubtitleScroll from '@/frontend/features/player/hooks/useSubtitleScroll';
import { cn } from '@/frontend/lib/utils';

const InnerNavigation: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { t: tNav } = useTranslation('nav');
    const { t: tPlayer } = useTranslation('player');
    const showSideBar = useLayout((s) => s.showSideBar);
    const changeSideBar = useLayout((s) => s.changeSideBar);

    const isPlayer = location.pathname.startsWith('/player');

    if (!isPlayer) {
        return null;
    }

    return (
        <div className="no-drag flex items-center h-full gap-[4px] shrink-0">
            <Tooltip content={tNav('backToLibrary', { defaultValue: '返回媒体库' })} placement="below">
                <button
                    type="button"
                    onClick={async () => {
                        await fileBrowserApi.changeWindowSize('home');
                        navigate('/');
                    }}
                    className={cn(
                        'inline-flex items-center justify-center w-[24px] h-[24px] rounded-md cursor-pointer select-none',
                        'text-secondary/80 hover:text-primary hover:bg-muted/70 active:bg-muted transition-colors',
                    )}
                    aria-label={tNav('backToLibrary', { defaultValue: '返回媒体库' })}
                >
                    <ArrowLeft className="w-[14px] h-[14px]" />
                </button>
            </Tooltip>
            <Tooltip
                content={
                    showSideBar
                        ? tPlayer('controlButton.closePanel', { defaultValue: '收起侧栏' })
                        : tPlayer('controlButton.openPanel', { defaultValue: '展开侧栏' })
                }
                placement="below"
            >
                <button
                    type="button"
                    onClick={async () => {
                        useSubtitleScroll.getState().pauseMeasurement();
                        await swrApiMutate('watch-history/list');
                        changeSideBar(!showSideBar);
                    }}
                    className={cn(
                        'inline-flex items-center justify-center w-[24px] h-[24px] rounded-md cursor-pointer select-none',
                        showSideBar
                            ? 'text-accent bg-accent-bg/15 hover:bg-accent-bg/25'
                            : 'text-secondary/80 hover:text-primary hover:bg-muted/70 active:bg-muted',
                        'transition-colors',
                    )}
                    aria-label={showSideBar ? tPlayer('controlButton.closePanel') : tPlayer('controlButton.openPanel')}
                >
                    <PanelLeft className="w-[14px] h-[14px]" />
                </button>
            </Tooltip>
        </div>
    );
};

/**
 * 桌面端统一标题栏导航控制组。
 *
 * 规范化交互设计：
 * 彻底移除浮在视频画面左上角的突兀悬浮按钮，将其规范收敛至桌面系统级顶栏左侧。
 * 在播放器环境提供「返回媒体库」与「展开/收起侧栏」操作，确保视频舞台 100% 纯净与零视线遮挡。
 * 在非 Router 启动门槛环境下安全静默，不引发 context 异常。
 */
export const TitleBarNavigation: React.FC = () => {
    const inRouter = useInRouterContext();
    if (!inRouter) {
        return null;
    }
    return <InnerNavigation />;
};

export default TitleBarNavigation;
