import React from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Link2 } from 'lucide-react';
import useSWR from 'swr';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { SideNavItem } from '@astryxdesign/core/SideNav';
import { youtubeImportApi } from './youtubeImportApi';
import useYoutubeImportUi from './youtubeImportUiStore';

/**
 * YouTube 导入侧边栏入口属性定义。
 */
export interface YoutubeImportSidebarItemProps {
    /** 侧栏窄栏模式：只显示图标。 */
    compact?: boolean;
}

/**
 * 侧栏「导入 YouTube 视频」入口：与导航项同款式，点击打开全局导入弹窗。
 *
 * 功能开关关闭时不渲染；与首页 YoutubeImportButton 共用同一 SWR 键，避免重复请求。
 *
 * @param props 组件属性。
 * @returns 导航条目 JSX 元素或 null。
 */
const YoutubeImportSidebarItem: React.FC<YoutubeImportSidebarItemProps> = () => {
    const { t } = useTranslation('nav');
    const { t: tYt } = useTranslation('youtubeImport');
    const { data: setting } = useSWR('youtube-import/setting-detail', () => youtubeImportApi.getSettingDetail(), {
        // 读取失败必须显式暴露：静默回退会让常驻入口消失，用户不知道功能其实已开启
        onError: () => toast.error(tYt('settings.loadFailed'), { id: 'youtube-import-setting' }),
    });
    const setOpen = useYoutubeImportUi((s) => s.setOpen);

    if (!setting?.enabled) return null;

    return (
        <SideNavItem
            label={t('youtubeImport')}
            icon={<Icon icon={Link2 as unknown as IconType} size="sm" color="secondary" />}
            onClick={() => setOpen(true)}
        />
    );
};

export default YoutubeImportSidebarItem;
