import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CircleX, Download, Loader2, PlayCircle } from 'lucide-react';
import { useSWRConfig } from 'swr';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/fronted/components/ui/dialog';
import { Button } from '@/fronted/components/ui/button';
import { Input } from '@/fronted/components/ui/input';
import { Progress } from '@/fronted/components/ui/progress';
import { apiPath } from '@/fronted/lib/swr-util';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import useDpTaskCenter from '@/fronted/hooks/useDpTaskCenter';
import { youtubeImportApi } from '@/fronted/features/youtube-import/youtubeImportApi';
import type { YoutubeImportTaskResult } from '@/common/contracts/youtube-import';
import { DpTaskState } from '@/common/contracts/dp-task';
import type { DpTask } from '@/common/contracts/dp-task';

/**
 * 从任务进度文本中解析下载百分比；无百分比时返回 null。
 */
const parsePercent = (progress: string | null): number | null => {
    if (!progress) return null;
    const match = /(\d+(?:\.\d+)?)%/.exec(progress);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
};

/**
 * 解析任务结果中的入库视频信息；结果缺失或格式不对时返回 null。
 */
const parseTaskResult = (task: DpTask): YoutubeImportTaskResult | null => {
    if (!task.result) return null;
    try {
        return JSON.parse(task.result) as YoutubeImportTaskResult;
    } catch {
        return null;
    }
};

interface YoutubeImportDialogProps {
    /** 弹窗是否打开。 */
    open: boolean;
    /** 开关弹窗回调。 */
    onOpenChange: (open: boolean) => void;
}

/**
 * YouTube 链接导入弹窗：粘贴地址发起下载，实时展示任务进度，完成后可直接跳转播放。
 */
const YoutubeImportDialog = ({ open, onOpenChange }: YoutubeImportDialogProps) => {
    const { t } = useTranslation('youtubeImport');
    const navigate = useNavigate();
    const { mutate } = useSWRConfig();
    const [url, setUrl] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [taskIds, setTaskIds] = React.useState<number[]>([]);
    const tasks = useDpTaskCenter((state) => state.tasks);
    const register = useDpTaskCenter((state) => state.register);

    const startImport = async () => {
        const trimmed = url.trim();
        if (!trimmed || submitting) return;
        setSubmitting(true);
        try {
            const taskId = await register(
                () => youtubeImportApi.start(trimmed).then((result) => result.taskId),
                {
                    onFinish: (task) => {
                        // 导入成功后刷新首页的观看历史缓存，新视频立刻出现在列表里。
                        if (task.status === DpTaskState.DONE) {
                            void mutate(apiPath('watch-history/list/basic'));
                            void mutate(apiPath('watch-history/list'));
                        }
                    },
                },
            );
            setTaskIds((prev) => [taskId, ...prev]);
            setUrl('');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setSubmitting(false);
        }
    };

    const playVideo = async (result: YoutubeImportTaskResult) => {
        await fileBrowserApi.changeWindowSize('player');
        navigate(`/player/${result.videoId}`);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('dialog.title')}</DialogTitle>
                    <DialogDescription>{t('dialog.description')}</DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2">
                    <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder={t('dialog.placeholder')}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                void startImport();
                            }
                        }}
                    />
                    <Button onClick={() => void startImport()} disabled={submitting || !url.trim()} className="shrink-0">
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {t('dialog.start')}
                    </Button>
                </div>
                {taskIds.length > 0 && (
                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                        {taskIds.map((taskId) => {
                            const task = tasks.get(taskId);
                            const taskView = task && task !== 'init' ? task : null;
                            const percent = taskView ? parsePercent(taskView.progress) : null;
                            const result = taskView ? parseTaskResult(taskView) : null;
                            const isDone = taskView?.status === DpTaskState.DONE;
                            const isFailed = taskView?.status === DpTaskState.FAILED;
                            const isCancelled = taskView?.status === DpTaskState.CANCELLED;
                            return (
                                <div key={taskId} className="rounded-xl border border-border/70 p-3 flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-medium text-foreground truncate">
                                            {taskView?.progress ?? t('dialog.pending')}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {isDone && result && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs gap-1"
                                                    onClick={() => void playVideo(result)}
                                                >
                                                    <PlayCircle className="h-3.5 w-3.5" />
                                                    {t('dialog.play')}
                                                </Button>
                                            )}
                                            {taskView?.status === DpTaskState.IN_PROGRESS && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                                                    onClick={() => void youtubeImportApi.cancel(taskId)}
                                                >
                                                    <CircleX className="h-3.5 w-3.5" />
                                                    {t('dialog.cancel')}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {percent !== null && !isDone && !isFailed && !isCancelled && (
                                        <Progress value={percent} className="h-1.5" />
                                    )}
                                    {isFailed && (
                                        <span className="text-xs text-destructive break-all line-clamp-3">
                                            {taskView?.result ?? t('dialog.failed')}
                                        </span>
                                    )}
                                    {isCancelled && (
                                        <span className="text-xs text-muted-foreground">{t('dialog.cancelled')}</span>
                                    )}
                                    {isDone && result && (
                                        <span className="text-xs text-muted-foreground truncate">
                                            {result.fileName}
                                            {result.attachedSrtFileName ? '' : ` · ${t('dialog.noSubtitle')}`}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default YoutubeImportDialog;
