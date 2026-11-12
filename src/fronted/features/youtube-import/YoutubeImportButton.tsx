import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Link2 } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@astryxdesign/core/Button';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import useDpTaskCenter from '@/fronted/app/stores/dpTaskStore';
import { isTerminalDpTaskState } from '@/common/contracts/dp-task';
import { youtubeImportApi } from '@/fronted/features/youtube-import/youtubeImportApi';
import useYoutubeImportUi from './youtubeImportUiStore';

/**
 * 首页「导入 YouTube 视频」入口：仅在功能开关开启时展示。
 * 点击只翻转全局开关，弹窗由 YoutubeImportDialogHost 单例承载；
 * 有进行中的任务时按钮直接显示数量，关闭弹窗也不会丢失进度感知。
 */
const YoutubeImportButton = () => {
    const { t } = useTranslation('youtubeImport');
    const { data: setting } = useSWR('youtube-import/setting-detail', () => youtubeImportApi.getSettingDetail(), {
        // 读取失败必须显式暴露：静默回退会让入口消失，用户不知道功能其实已开启
        onError: () => toast.error(t('settings.loadFailed'), { id: 'youtube-import-setting' }),
    });
    const setOpen = useYoutubeImportUi((s) => s.setOpen);
    const tasks = useYoutubeImportUi((s) => s.tasks);
    const taskStates = useDpTaskCenter((s) => s.tasks);
    const activeCount = tasks.filter((entry) => {
        const task = taskStates.get(entry.taskId);
        return !task || task === 'init' || !isTerminalDpTaskState(task.status);
    }).length;

    if (!setting?.enabled) return null;
    return (
        <Button
            variant="secondary"
            label={activeCount > 0 ? t('entry.active', { count: activeCount }) : t('entry.button')}
            icon={<Icon icon={Link2 as unknown as IconType} size="sm" />}
            onClick={() => setOpen(true)}
            width={144}
        />
    );
};

export default YoutubeImportButton;
