import { useLocation, useNavigate } from 'react-router-dom';
import { cloneElement, type ReactElement } from 'react';
import { cn } from '@/fronted/lib/utils';
import logoLight from '../../../../assets/logo-light.png';
import logoDark from '../../../../assets/logo-dark.png';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import YoutubeImportSidebarItem from '@/fronted/features/youtube-import/YoutubeImportSidebarItem';
import useSetting from '@/fronted/features/settings/settingsStore';
import { BookOpen, Captions, Rotate3D, Settings, SquareSplitHorizontal, Star, Video } from 'lucide-react';
import { useTranslation as useI18nTranslation } from 'react-i18next';

/** 左侧主导航栏属性。 */
export interface SideBarProps {
    /** 是否以紧凑图标模式展示。 */
    compact?: boolean;
}

/**
 * 桌面端主导航侧栏，提供各核心功能页面入口及当前主题标识。
 */
const SideBar = ({ compact = false }: SideBarProps) => {
    const { t } = useI18nTranslation('nav');
    const navigate = useNavigate();
    const location = useLocation();
    const videoId = usePlaybackSession((s) => s.videoId);
    const theme = useSetting((s) => s.values.get('appearance.theme'));
    const item = (
        text: string,
        path: string,
        key: string,
        icon: ReactElement
    ) => {
        const isPlayer = key === 'pa-player';
        const isActive = isPlayer
            ? location.pathname.startsWith('/player')
            : location.pathname.includes(key);
        return (
            <div
                onMouseDown={() => navigate(path)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(path);
                    }
                }}
                className={cn(
                    'w-full px-2 flex justify-start items-center gap-2 rounded-xl h-10 transition-all',
                    isActive
                        ? 'bg-white dark:bg-neutral-900 shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-none text-foreground font-medium'
                        : 'text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5',
                    compact && 'justify-center'
                )}
            >
                {cloneElement(icon as ReactElement<{ className?: string }>, {
                    className: cn('w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0')
                })}
                {!compact && (
                    <div className={cn('text-base text-foreground  truncate w-0 flex-1')}>
                        {text}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={cn('w-full h-full flex flex-col text-foreground')}>
            <div
                className={cn(
                    'flex-1 flex items-center justify-center min-h-fit py-10'
                )}
            >
                <img
                    className={cn(
                        'w-24 h-24 user-drag-none',
                        compact && 'w-14 h-14'
                    )}
                    src={(theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)) ? logoDark : logoLight}
                    alt=""
                />
            </div>
            <div className={cn('basis-3/4 flex flex-col p-3 gap-1')}>
                {/* {item('Home', '/home', 'home', <HiOutlineHome />)} */}
                <YoutubeImportSidebarItem compact={compact} />
                {item(
                    t('playbackLab'),
                    `/player/${videoId}?sideBarAnimation=false`,
                    'pa-player',
                    <Video />
                )}
                {item(
                    t('savedMoments'),
                    '/favorite',
                    'favorite',
                    <Star />
                )}
                {item(
                    t('sentenceSplitter'),
                    '/split',
                    'split',
                    <SquareSplitHorizontal />
                )}
                {item(
                    t('vocabularyStudio'),
                    '/vocabulary',
                    'vocabulary',
                    <BookOpen />
                )}
                {item(t('settingsCenter'), '/settings', 'settings', <Settings />)}
            </div>
        </div>
    );
};

export default SideBar;
