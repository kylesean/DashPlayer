import { useLocation, useNavigate } from 'react-router-dom';
import React from 'react';
import { BookOpenText, Layers, LayoutGrid, PanelLeftClose, PanelLeftOpen, Settings, Video } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Center } from '@astryxdesign/core/Center';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { VStack } from '@astryxdesign/core/VStack';
import { usePlaybackSession } from '@/frontend/features/player/playbackSessionStore';
import YoutubeImportSidebarItem from '@/frontend/features/youtube-import/YoutubeImportSidebarItem';
import useLayout from '@/frontend/app/stores/layoutStore';
import { cn } from '@/frontend/lib/utils';
import { NAV_TESTIDS } from '@/common/constants/qa-testids';
import { fileBrowserApi } from '@/frontend/features/file-browser/fileBrowserApi';

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
    const sidebarCollapsed = useLayout((s) => s.sidebarCollapsed);
    const toggleSidebarCollapsed = useLayout((s) => s.toggleSidebarCollapsed);
    const changeSideBar = useLayout((s) => s.changeSideBar);

    const isCompact = compact ?? sidebarCollapsed;

    const isHome = location.pathname === '/' || location.pathname === '/home';
    const isPlayer = location.pathname.startsWith('/player');
    const isReader = location.pathname.startsWith('/reader');
    const isVocabulary = location.pathname.startsWith('/vocabulary') || location.pathname.startsWith('/context-studio');
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
            style={{ width: isCompact ? 56 : 208, minWidth: 0 }}
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
                            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-lg cursor-pointer p-1 text-primary transition-transform duration-200 hover:scale-105"
                            aria-label={t('home', { defaultValue: '首页' })}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 111 101"
                                className="w-7 h-7 fill-current"
                                aria-label={t('appTitle', { defaultValue: 'Refrain' })}
                            >
                                <path d="M6.43 0V-100H42.29Q54.29 -100 62 -95.93Q69.71 -91.86 73.5 -85.07Q77.29 -78.29 77.29 -69.71Q77.29 -61.71 73.57 -54.86Q69.86 -48 62.07 -43.86Q54.29 -39.71 42 -39.71H23.57V0ZM58.57 0 37.57 -44.14H56.29L78.29 0ZM23.57 -52.43H41.29Q50.71 -52.43 55.21 -57.07Q59.71 -61.71 59.71 -69.29Q59.71 -76.71 55.36 -81.21Q51 -85.71 41.14 -85.71H23.57Z" transform="translate(-6.429,100.000)" />
                                <path d="M15.71 0.71Q11.14 0.71 8.07 -2.29Q5 -5.29 5 -9.43Q5 -13.71 8.07 -16.64Q11.14 -19.57 15.71 -19.57Q20.29 -19.57 23.29 -16.64Q26.29 -13.71 26.29 -9.43Q26.29 -5.29 23.29 -2.29Q20.29 0.71 15.71 0.71Z" transform="translate(83.997,100.000)" />
                            </svg>
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
                        className="flex flex-col items-center justify-center text-center gap-1.5 px-3 py-2.5 w-full select-none cursor-pointer rounded-xl hover:bg-muted/40 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 440 104"
                            className="h-6 w-auto text-primary fill-current shrink-0"
                            aria-label={t('appTitle', { defaultValue: 'Refrain' })}
                        >
                            <g transform="translate(-6.43,101.71)">
                                <path d="M6.43 0V-100H42.29Q54.29 -100 62 -95.93Q69.71 -91.86 73.5 -85.07Q77.29 -78.29 77.29 -69.71Q77.29 -61.71 73.57 -54.86Q69.86 -48 62.07 -43.86Q54.29 -39.71 42 -39.71H23.57V0ZM58.57 0 37.57 -44.14H56.29L78.29 0ZM23.57 -52.43H41.29Q50.71 -52.43 55.21 -57.07Q59.71 -61.71 59.71 -69.29Q59.71 -76.71 55.36 -81.21Q51 -85.71 41.14 -85.71H23.57Z M115.86 1.71Q105.14 1.71 96.93 -2.93Q88.71 -7.57 84.07 -15.79Q79.43 -24 79.43 -35Q79.43 -46.14 84 -54.57Q88.57 -63 96.79 -67.79Q105 -72.57 116 -72.57Q126.43 -72.57 134.36 -67.93Q142.29 -63.29 146.64 -55.57Q151 -47.86 151 -38.14Q151 -36.71 151 -35Q151 -33.29 150.71 -31.29H91.86V-42.29H133.71Q133.29 -50.14 128.29 -54.64Q123.29 -59.14 115.86 -59.14Q110.57 -59.14 106.07 -56.79Q101.57 -54.43 98.93 -49.64Q96.29 -44.86 96.29 -37.43V-33.29Q96.29 -26.71 98.86 -22Q101.43 -17.29 105.93 -14.79Q110.43 -12.29 115.71 -12.29Q121.57 -12.29 125.57 -14.93Q129.57 -17.57 131.57 -22.14H149Q147 -15.29 142.36 -9.93Q137.71 -4.57 131 -1.43Q124.29 1.71 115.86 1.71Z M162.43 0V-77Q162.43 -85.29 165.21 -90.36Q168 -95.43 173.29 -97.71Q178.57 -100 185.86 -100H193.57V-86H188.43Q183.71 -86 181.64 -84Q179.57 -82 179.57 -77.29V0ZM152.43 -57.43V-70.86H195.14V-57.43Z M199.43 0V-70.86H214.14L215.57 -55.43H216.14Q219.43 -62.86 223.07 -66.57Q226.71 -70.29 231.43 -71.43Q236.14 -72.57 242.43 -72.57V-54.57H237.86Q232.71 -54.57 228.64 -53.29Q224.57 -52 221.93 -49.5Q219.29 -47 217.93 -43.07Q216.57 -39.14 216.57 -33.57V0Z M269.29 1.71Q260.86 1.71 255.36 -1.21Q249.86 -4.14 247.21 -9.07Q244.57 -14 244.57 -19.86Q244.57 -26.57 248.07 -31.5Q251.57 -36.43 258.43 -39.21Q265.29 -42 275.43 -42H293.57Q293.57 -47.86 291.93 -51.64Q290.29 -55.43 286.93 -57.21Q283.57 -59 278.57 -59Q272.71 -59 268.36 -56.21Q264 -53.43 263.14 -47.57H246.29Q247 -55.29 251.29 -60.86Q255.57 -66.43 262.64 -69.5Q269.71 -72.57 278.71 -72.57Q288.86 -72.57 296.07 -69.07Q303.29 -65.57 307 -59.14Q310.71 -52.71 310.71 -43.57V0H296.57L294.71 -11.43H294.14Q292.14 -8 289.43 -5.57Q286.71 -3.14 283.64 -1.57Q280.57 0 276.93 0.86Q273.29 1.71 269.29 1.71ZM274.57 -11.86Q278.86 -11.86 282.21 -13.36Q285.57 -14.86 287.86 -17.57Q290.14 -20.29 291.5 -23.71Q292.86 -27.14 293.14 -31H277.29Q272.14 -31 268.86 -29.71Q265.57 -28.43 264.07 -26.21Q262.57 -24 262.57 -21.14Q262.57 -18.14 264.07 -16.07Q265.57 -14 268.21 -12.93Q270.86 -11.86 274.57 -11.86Z M320.86 0V-70.86H338V0ZM329.43 -81.29Q324.71 -81.29 321.64 -84.21Q318.57 -87.14 318.57 -91.57Q318.57 -95.86 321.64 -98.79Q324.71 -101.71 329.43 -101.71Q334.14 -101.71 337.29 -98.79Q340.43 -95.86 340.43 -91.43Q340.43 -87.14 337.29 -84.21Q334.14 -81.29 329.43 -81.29Z M349 0V-70.86H363.71L365.14 -59.43H365.71Q369.29 -65.57 375.21 -69.07Q381.14 -72.57 389.86 -72.57Q398.43 -72.57 404.57 -68.93Q410.71 -65.29 414 -58.07Q417.29 -50.86 417.29 -40.29V0H400.29V-38.57Q400.29 -48 396.36 -53.07Q392.43 -58.14 384.29 -58.14Q379 -58.14 374.93 -55.57Q370.86 -53 368.5 -48.21Q366.14 -43.43 366.14 -36.57V0Z M435.14 0.71Q430.57 0.71 427.5 -2.29Q424.43 -5.29 424.43 -9.43Q424.43 -13.71 427.5 -16.64Q430.57 -19.57 435.14 -19.57Q439.71 -19.57 442.71 -16.64Q445.71 -13.71 445.71 -9.43Q445.71 -5.29 442.71 -2.29Q439.71 0.71 435.14 0.71Z" />
                            </g>
                        </svg>
                        <span className="text-metadata text-secondary font-medium tracking-wide truncate max-w-full">
                            {t('appTagline', { defaultValue: '精选英语，反复聆听' })}
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
                    data-testid={NAV_TESTIDS.reader}
                    label={t('scriptReader', { defaultValue: '精读文稿' })}
                    href={videoId && videoId !== 'undefined' ? `/reader/${videoId}` : '/reader'}
                    icon={
                        <Icon
                            icon={BookOpenText as unknown as IconType}
                            size="sm"
                            color={isReader ? 'primary' : 'secondary'}
                        />
                    }
                    isSelected={isReader}
                />

                <SideNavItem
                    data-testid={NAV_TESTIDS.vocabulary}
                    label={t('vocabularyStudio')}
                    href="/context-studio"
                    icon={
                        <Icon
                            icon={Layers as unknown as IconType}
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
