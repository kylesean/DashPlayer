import { useLocation, useNavigate } from 'react-router-dom';
import React, { useMemo } from 'react';
import { BookOpen, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, Video, X } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Center } from '@astryxdesign/core/Center';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { VStack } from '@astryxdesign/core/VStack';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import logoLight from '../../../../assets/logo-light.png';
import logoDark from '../../../../assets/logo-dark.png';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import YoutubeImportSidebarItem from '@/fronted/features/youtube-import/YoutubeImportSidebarItem';
import useSetting from '@/fronted/features/settings/settingsStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import { cn } from '@/fronted/lib/utils';

/**
 * 左侧主导航栏属性定义。
 */
export interface SideBarProps {
    /** 是否以紧凑图标模式展示；若未传入则根据全局 sidebarCollapsed 判定。 */
    compact?: boolean;
    /** 是否处于播放器环境（在播放器中支持一键完全隐藏侧栏进入极简观影）。 */
    inPlayer?: boolean;
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
const SideBar: React.FC<SideBarProps> = ({ compact, inPlayer = false }) => {
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

    const isPlayer = location.pathname.startsWith('/player');
    const isVocabulary = location.pathname.startsWith('/vocabulary');
    const isSettings = location.pathname.startsWith('/settings');

    return (
        <SideNav
            collapsible={isCompact ? { isCollapsed: true } : false}
            header={
                isCompact ? (
                    <Center width="100%" paddingBlock={2}>
                        <img
                            className="user-drag-none w-8 h-8 rounded-lg shadow-xs transition-transform duration-200 hover:scale-105"
                            src={isDark ? logoDark : logoLight}
                            alt="DashPlayer Logo"
                        />
                    </Center>
                ) : (
                    <div className="flex items-center gap-2.5 px-3 py-2.5 w-full select-none">
                        <img
                            className="user-drag-none w-8 h-8 rounded-lg shadow-xs shrink-0"
                            src={isDark ? logoDark : logoLight}
                            alt="DashPlayer Logo"
                        />
                        <div className="flex flex-col min-w-0">
                            <span className="text-sm font-semibold tracking-tight text-foreground truncate leading-tight">
                                DashPlayer
                            </span>
                            <span className="text-[10px] text-muted-foreground/75 font-medium tracking-wide uppercase truncate">
                                English Studio
                            </span>
                        </div>
                    </div>
                )
            }
            footer={
                !isCompact ? (
                    <div className="mx-2 mb-2 p-2.5 rounded-xl bg-accent-muted/10 border border-accent/20 select-none">
                        <div className="flex items-center gap-1.5 text-accent font-medium text-xs mb-1">
                            <Sparkles className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('learningMotivationTitle', { defaultValue: '沉浸伴读' })}</span>
                        </div>
                        <p className="text-muted-foreground/80 text-[10px] leading-relaxed">
                            {t('learningMotivationHint', { defaultValue: '精听盲听 · 影子跟读 · 自然语感' })}
                        </p>
                    </div>
                ) : null
            }
            footerIcons={
                <div
                    className={cn(
                        'flex items-center w-full select-none border-t border-border/30 pt-1',
                        isCompact ? 'justify-center' : 'justify-between px-2',
                    )}
                >
                    <Tooltip
                        content={isCompact ? t('expandSidebar', { defaultValue: '展开导航栏' }) : t('collapseSidebar', { defaultValue: '收起导航栏' })}
                        placement="end"
                    >
                        <button
                            type="button"
                            onClick={toggleSidebarCollapsed}
                            className={cn(
                                'flex items-center gap-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer',
                                isCompact ? 'w-8 h-8 justify-center' : 'px-2 py-1.5',
                            )}
                            aria-label={isCompact ? t('expandSidebar') : t('collapseSidebar')}
                        >
                            {isCompact ? (
                                <PanelLeftOpen className="w-4 h-4" />
                            ) : (
                                <>
                                    <PanelLeftClose className="w-4 h-4 shrink-0" />
                                    <span>{t('collapseSidebar')}</span>
                                </>
                            )}
                        </button>
                    </Tooltip>

                    {inPlayer && !isCompact && (
                        <Tooltip content={t('hideSidebar', { defaultValue: '完全收起侧栏' })} placement="above">
                            <button
                                type="button"
                                onClick={() => changeSideBar(false)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                                aria-label={t('hideSidebar')}
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </Tooltip>
                    )}
                </div>
            }
        >
            <VStack gap={1} width="100%">
                <YoutubeImportSidebarItem compact={isCompact} />

                <SideNavItem
                    label={t('playbackLab')}
                    icon={
                        <Icon
                            icon={Video as unknown as IconType}
                            size="sm"
                            color={isPlayer ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isPlayer}
                    onClick={() => {
                        if (videoId && videoId !== 'undefined') {
                            navigate(`/player/${videoId}?sideBarAnimation=false`);
                        } else {
                            navigate('/player?sideBarAnimation=false');
                        }
                    }}
                />

                <SideNavItem
                    label={t('vocabularyStudio')}
                    icon={
                        <Icon
                            icon={BookOpen as unknown as IconType}
                            size="sm"
                            color={isVocabulary ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isVocabulary}
                    onClick={() => navigate('/vocabulary')}
                />

                <SideNavItem
                    label={t('settingsCenter')}
                    icon={
                        <Icon
                            icon={Settings as unknown as IconType}
                            size="sm"
                            color={isSettings ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isSettings}
                    onClick={() => navigate('/settings')}
                />
            </VStack>
        </SideNav>
    );
};

export default SideBar;
