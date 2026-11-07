import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import useSWR from 'swr';
import { cn } from '@/fronted/lib/utils';
import { youtubeImportApi } from './youtubeImportApi';
import useYoutubeImportUi from './youtubeImportUiStore';

export interface YoutubeImportSidebarItemProps {
    /** 侧栏窄栏模式：只显示图标。 */
    compact?: boolean;
}

/**
 * 侧栏「导入 YouTube 视频」入口：与导航项同款式，点击打开全局导入弹窗。
 *
 * 功能开关关闭时不渲染；与首页 YoutubeImportButton 共用同一 SWR 键，避免重复请求。
 */
const YoutubeImportSidebarItem = ({ compact }: YoutubeImportSidebarItemProps) => {
    const { t } = useTranslation('nav');
    const { data: setting } = useSWR('youtube-import/setting-detail', () => youtubeImportApi.getSettingDetail());
    const setOpen = useYoutubeImportUi((s) => s.setOpen);

    if (!setting?.enabled) return null;
    return (
        <div
            onMouseDown={() => setOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpen(true);
                }
            }}
            className={cn(
                'w-full px-2 flex justify-start items-center gap-2 rounded-xl h-10 transition-all',
                'text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5',
                compact && 'justify-center'
            )}
        >
            <Link2 className="w-5 h-5 text-yellow-600 text-yellow-500 flex-shrink-0" />
            {!compact && (
                <div className={cn('text-base text-foreground truncate w-0 flex-1')}>
                    {t('sidebarEntry')}
                </div>
            )}
        </div>
    );
};

export default YoutubeImportSidebarItem;
