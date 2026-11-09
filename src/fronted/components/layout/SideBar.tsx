import { useLocation, useNavigate } from 'react-router-dom';
import React, { useMemo } from 'react';
import { BookOpen, Settings, Video } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Center } from '@astryxdesign/core/Center';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { VStack } from '@astryxdesign/core/VStack';
import logoLight from '../../../../assets/logo-light.png';
import logoDark from '../../../../assets/logo-dark.png';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import YoutubeImportSidebarItem from '@/fronted/features/youtube-import/YoutubeImportSidebarItem';
import useSetting from '@/fronted/features/settings/settingsStore';

/**
 * 左侧主导航栏属性定义。
 */
export interface SideBarProps {
    /** 是否以紧凑图标模式展示。 */
    compact?: boolean;
}

/**
 * 桌面端主导航侧栏：提供核心功能页面入口及主题标识。
 *
 * 基于 Astryx SideNav 与 SideNavItem 构建，根据窗口尺寸自适应宽栏/窄栏模式。
 *
 * @param props 组件属性。
 * @returns 侧栏 JSX 元素。
 */
const SideBar: React.FC<SideBarProps> = ({ compact = false }) => {
    const { t } = useI18nTranslation('nav');
    const navigate = useNavigate();
    const location = useLocation();
    const videoId = usePlaybackSession((s) => s.videoId);
    const theme = useSetting((s) => s.values.get('appearance.theme'));

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
            collapsible={compact ? { isCollapsed: true } : false}
            header={
                <Center width="100%" paddingBlock={compact ? 3 : 6}>
                    <img
                        className="user-drag-none transition-all duration-200"
                        style={{ width: compact ? 36 : 72, height: compact ? 36 : 72 }}
                        src={isDark ? logoDark : logoLight}
                        alt="DashPlayer Logo"
                    />
                </Center>
            }
        >
            <VStack gap={1} width="100%">
                <YoutubeImportSidebarItem compact={compact} />

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
