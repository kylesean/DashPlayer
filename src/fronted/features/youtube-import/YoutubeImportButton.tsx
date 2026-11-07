import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@/fronted/components/ui/button';
import { youtubeImportApi } from '@/fronted/features/youtube-import/youtubeImportApi';
import YoutubeImportDialog from '@/fronted/features/youtube-import/YoutubeImportDialog';

/**
 * 首页「粘贴链接导入」入口：仅在功能开关开启时展示，点击弹出导入弹窗。
 */
const YoutubeImportButton = () => {
    const { t } = useTranslation('youtubeImport');
    const { data: setting } = useSWR('youtube-import/setting-detail', () => youtubeImportApi.getSettingDetail());
    const [open, setOpen] = React.useState(false);

    if (!setting?.enabled) return null;
    return (
        <>
            <Button
                variant="outline"
                className="w-36 rounded-xl h-10 gap-2"
                onClick={() => setOpen(true)}
            >
                <Link2 className="h-4 w-4" />
                {t('entry.button')}
            </Button>
            <YoutubeImportDialog open={open} onOpenChange={setOpen} />
        </>
    );
};

export default YoutubeImportButton;
