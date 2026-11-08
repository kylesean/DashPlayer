import React from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Link2 } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@astryxdesign/core/Button';
import { youtubeImportApi } from '@/fronted/features/youtube-import/youtubeImportApi';
import useYoutubeImportUi from './youtubeImportUiStore';

/**
 * 首页「粘贴链接导入」入口：仅在功能开关开启时展示。
 * 点击只翻转全局开关，弹窗由 YoutubeImportDialogHost 单例承载。
 */
const YoutubeImportButton = () => {
    const { t } = useTranslation('youtubeImport');
    const { data: setting } = useSWR('youtube-import/setting-detail', () => youtubeImportApi.getSettingDetail(), {
        // 读取失败必须显式暴露：静默回退会让入口消失，用户不知道功能其实已开启
        onError: () => toast.error(t('settings.loadFailed'), { id: 'youtube-import-setting' }),
    });
    const setOpen = useYoutubeImportUi((s) => s.setOpen);

    if (!setting?.enabled) return null;
    return (
        <Button
            variant="secondary"
            label={t('entry.button')}
            icon={<Link2 className="h-4 w-4" />}
            onClick={() => setOpen(true)}
            width={144}
        />
    );
};

export default YoutubeImportButton;
