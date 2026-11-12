import { useLocation, useNavigate } from 'react-router-dom';
import React, { useMemo } from 'react';
import { BookOpen, LayoutGrid, PanelLeftClose, PanelLeftOpen, Settings, Video } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Center } from '@astryxdesign/core/Center';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { VStack } from '@astryxdesign/core/VStack';
import mark from '../../../../assets/brand/refrain/mark.svg';
import markReverse from '../../../../assets/brand/refrain/mark-reverse.svg';
import wordmark from '../../../../assets/brand/refrain/wordmark.svg';
import wordmarkReverse from '../../../../assets/brand/refrain/wordmark-reverse.svg';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import YoutubeImportSidebarItem from '@/fronted/features/youtube-import/YoutubeImportSidebarItem';
import useSetting from '@/fronted/features/settings/settingsStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import { cn } from '@/fronted/lib/utils';
import { NAV_TESTIDS } from '@/common/constants/qa-testids';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';

/**
 * 左侧主导航栏属性定义。
 */
export interface SideBarProps {
    /** 是否以紧凑图标模式展示；若未传入则根据全局 sidebarCollapsed 判定。 */
    compact?: boolean;
    /** 是否处于播放器环境（在播放器中支持一键完全隐藏侧栏进入极简观影）。 */
    inPlayer?: boolean;
    /** 折叠按钮的自定义切换逻辑；不传时用全局 sidebarCollapsed。 */
    onToggleCollapse?: () => void;
    /** 窗口过窄等场景下禁用折叠按钮，避免点了没有任何视觉变化。 */
    collapseDisabled?: boolean;
}

/**
 * 桌面端主导航侧栏：专为沉浸式语言训练定制的场景化 Studio 导航栏。
 *
 * 遵循语言学习产品交互哲学：
 * 1. 彻底摆脱传统 B 端管理后台的空洞冷漠感，采用精致的 32px 品牌标识与“沉浸伴读”学习温度卡片。
 * 2. 支持显式的折叠/展开交互按钮（PanelLeftClose/PanelLeftOpen），在 56px 紧凑图标轨与 208px 完整菜单之间自如切换。
 * 3. 在播放器环境中支持一键完全隐藏侧栏，将 100% 视野归还给视频画面与流式字幕。
 *
 * @param props 组件属性。
 * @returns 侧栏 JSX 元素。
 */
const SideBar: React.FC<SideBarProps> = ({
    compact,
    inPlayer = false,
    onToggleCollapse,
    collapseDisabled = false,
}) => {
    const { t } = useI18nTranslation('nav');
    const navigate = useNavigate();
    const location = useLocation();
    const videoId = usePlaybackSession((s) => s.videoId);
    const theme = useSetting((s) => s.values.get('appearance.theme'));
    const sidebarCollapsed = useLayout((s) => s.sidebarCollapsed);
    const toggleSidebarCollapsed = useLayout((s) => s.toggleSidebarCollapsed);
    const changeSideBar = useLayout((s) => s.changeSideBar);

    const isCompact = compact ?? sidebarCollapsed;

    const isDark = useMemo(() => {
        if (theme === 'dark') return true;
        if (theme === 'light') return false;
        return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    }, [theme]);

    const isHome = location.pathname === '/' || location.pathname === '/home';
    const isPlayer = location.pathname.startsWith('/player');
    const isVocabulary = location.pathname.startsWith('/vocabulary');
    const isSettings = location.pathname.startsWith('/settings');

    const navigateHome = () => {
        void fileBrowserApi.changeWindowSize('home');
        navigate('/');
    };

    /** 折叠状态由外层 AppShell 控制，切换动作统一走这里。 */
    const handleToggleCollapse = () => {
        if (collapseDisabled) return;
        if (inPlayer) {
            changeSideBar(false);
            return;
        }
        if (onToggleCollapse) {
            onToggleCollapse();
        } else {
            toggleSidebarCollapsed();
        }
    };

    return (
        <SideNav
            // 受控折叠：hasButton:false，折叠/展开按钮由下方 footerIcons 提供一份；
            // 交给 SideNav 再渲染一颗，会出现两颗重复的折叠控件
            collapsible={{
                isCollapsed: isCompact,
                onCollapsedChange: handleToggleCollapse,
                hasButton: false,
            }}
            header={
                isCompact ? (
                    <Center width="100%" paddingBlock={2}>
                        <button
                            type="button"
                            onClick={navigateHome}
                            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg cursor-pointer"
                            aria-label={t('home', { defaultValue: '首页' })}
                        >
                            <img
                                className="user-drag-none w-8 h-8 object-contain transition-transform duration-200 hover:scale-105"
                                src={isDark ? markReverse : mark}
                                alt={t('appTitle', { defaultValue: 'Refrain' })}
                            />
                        </button>
                    </Center>
                ) : (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={navigateHome}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                navigateHome();
                            }
                        }}
                        className="flex flex-col gap-1.5 px-3 py-2.5 w-full select-none cursor-pointer rounded-xl hover:bg-muted/40 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <img
                            className="user-drag-none h-6 w-auto object-contain shrink-0"
                            src={isDark ? wordmarkReverse : wordmark}
                            alt={t('appTitle', { defaultValue: 'Refrain' })}
                        />
                        <span className="text-metadata text-muted-foreground font-medium tracking-wide uppercase truncate">
                            {t('appTagline', { defaultValue: 'Curated English, on repeat.' })}
                        </span>
                    </div>
                )
            }
            footerIcons={
                inPlayer ? undefined : (
                    <div
                        className={cn(
                            'flex items-center w-full select-none border-t border-border/30 pt-1',
                            isCompact ? 'justify-center' : 'justify-between px-2',
                        )}
                    >
                        <IconButton
                            label={
                                isCompact
                                    ? t('expandSidebar', { defaultValue: '展开导航栏' })
                                    : t('collapseSidebar', { defaultValue: '收起导航栏' })
                            }
                            tooltip={
                                collapseDisabled
                                    ? t('sidebarFixedCompact', { defaultValue: '窗口较窄时固定为图标导航' })
                                    : isCompact
                                        ? t('expandSidebar', { defaultValue: '展开导航栏' })
                                        : t('collapseSidebar', { defaultValue: '收起导航栏' })
                            }
                            icon={<Icon icon={isCompact ? PanelLeftOpen : PanelLeftClose} size="sm" />}
                            variant="ghost"
                            size="sm"
                            isDisabled={collapseDisabled}
                            onClick={handleToggleCollapse}
                        />
                    </div>
                )
            }
        >
            <VStack gap={1} width="100%">
                <SideNavItem
                    data-testid={NAV_TESTIDS.home}
                    label={t('mediaLibrary', { defaultValue: '媒体库' })}
                    href="/"
                    icon={
                        <Icon
                            icon={LayoutGrid as unknown as IconType}
                            size="sm"
                            color={isHome ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isHome}
                    // href 由 Astryx 渲染为 Router Link，导航交给链接本身；
                    // 这里只补媒体库窗口尺寸切换，避免与链接各导航一次。
                    onClick={() => {
                        void fileBrowserApi.changeWindowSize('home');
                    }}
                />

                <YoutubeImportSidebarItem compact={isCompact} />

                <SideNavItem
                    data-testid={NAV_TESTIDS.player}
                    label={t('playbackLab')}
                    href={
                        videoId && videoId !== 'undefined'
                            ? `/player/${videoId}?sideBarAnimation=false`
                            : '/player?sideBarAnimation=false'
                    }
                    icon={
                        <Icon
                            icon={Video as unknown as IconType}
                            size="sm"
                            color={isPlayer ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isPlayer}
                />

                <SideNavItem
                    data-testid={NAV_TESTIDS.vocabulary}
                    label={t('vocabularyStudio')}
                    href="/vocabulary"
                    icon={
                        <Icon
                            icon={BookOpen as unknown as IconType}
                            size="sm"
                            color={isVocabulary ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isVocabulary}
                />

                <SideNavItem
                    data-testid={NAV_TESTIDS.settings}
                    label={t('settingsCenter')}
                    href="/settings"
                    icon={
                        <Icon
                            icon={Settings as unknown as IconType}
                            size="sm"
                            color={isSettings ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isSettings}
                />
            </VStack>
        </SideNav>
    );
};

export default SideBar;
