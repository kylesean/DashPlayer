import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Clapperboard, Download, Loader2, PlayCircle } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@/fronted/components/ui/button';
import { Input } from '@/fronted/components/ui/input';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import FolderSelector, { FolderSelectAction } from '@/fronted/features/file-browser/components/FolderSelector';
import FileSelector, { FileAction } from '@/fronted/features/file-browser/components/FileSelector';
import useLayout from '@/fronted/app/stores/layoutStore';
import { youtubeImportApi } from './youtubeImportApi';
import useYoutubeImportTasks from './useYoutubeImportTasks';
import YoutubeImportTaskRow from './YoutubeImportTaskRow';

/**
 * 无播放历史时的主视觉：YouTube 链接导入是一等入口，粘贴即导入、完成自动跳转播放；
 * 本地文件选择降级为次要路径。功能开关关闭时回退为旧版本地文件空状态。
 */
const YoutubeImportHero = () => {
    const { t } = useTranslation('youtubeImport');
    const { t: tc } = useTranslation('common');
    const navigate = useNavigate();
    const changeSideBar = useLayout((s) => s.changeSideBar);
    const { data: setting } = useSWR('youtube-import/setting-detail', () => youtubeImportApi.getSettingDetail(), {
        // 读取失败必须显式暴露：静默回退会让入口消失、退回旧空态，用户不知道功能其实已开启
        onError: () => toast.error(t('settings.loadFailed'), { id: 'youtube-import-setting' }),
    });
    const ytEnabled = setting?.enabled ?? false;
    const { url, setUrl, submitting, taskIds, startImport, playVideo } = useYoutubeImportTasks();

    const localSelectors = (
        <div className="flex items-center gap-3 w-full justify-center">
            <div className="w-36">
                <FileSelector
                    onSelected={FileAction.playerAction2(navigate)}
                    withMkv
                />
            </div>
            <div className="w-36">
                <FolderSelector
                    onSelected={FolderSelectAction.defaultAction2(async (vid) => {
                        await fileBrowserApi.changeWindowSize('player');
                        changeSideBar(false);
                        navigate(`/player/${vid}`);
                    })}
                />
            </div>
        </div>
    );

    if (!ytEnabled) {
        // 功能关闭时的旧版空状态：仅保留本地文件入口。
        return (
            <div className="flex flex-col items-center max-w-md w-full">
                <div className="h-16 w-16 rounded-3xl bg-primary/10 flex items-center justify-center text-primary mb-5 shadow-xs">
                    <PlayCircle className="h-8 w-8 stroke-[1.75]" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-1.5">
                    {tc('emptyWatchTitle')}
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed mb-6">
                    {tc('emptyWatchDesc')}
                </p>
                {localSelectors}
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center max-w-xl w-full">
            <div className="h-16 w-16 rounded-3xl bg-primary/10 flex items-center justify-center text-primary mb-5 shadow-xs">
                <Clapperboard className="h-8 w-8 stroke-[1.75]" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-1.5">
                {t('hero.title')}
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
                {t('hero.description')}
            </p>

            <div className="flex items-center gap-2 w-full">
                <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t('dialog.placeholder')}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            void startImport();
                        }
                    }}
                    className="h-11"
                />
                <Button onClick={() => void startImport()} disabled={submitting || !url.trim()} className="shrink-0 h-11 gap-2">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {t('hero.start')}
                </Button>
            </div>

            {taskIds.length > 0 && (
                <div className="flex flex-col gap-2 w-full mt-4 max-h-72 overflow-y-auto text-left">
                    {taskIds.map((taskId) => (
                        <YoutubeImportTaskRow
                            key={taskId}
                            taskId={taskId}
                            onPlay={(result) => void playVideo(result)}
                        />
                    ))}
                </div>
            )}

            <div className="flex items-center gap-3 w-full my-5">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-xs text-muted-foreground/80">{t('hero.orLocal')}</span>
                <div className="h-px flex-1 bg-border/60" />
            </div>
            {localSelectors}
        </div>
    );
};

export default YoutubeImportHero;
