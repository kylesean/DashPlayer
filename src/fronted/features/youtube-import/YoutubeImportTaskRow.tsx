import { useTranslation } from 'react-i18next';
import { CircleX, PlayCircle } from 'lucide-react';
import { Button } from '@/fronted/components/ui/button';
import { Progress } from '@/fronted/components/ui/progress';
import useDpTaskCenter from '@/fronted/hooks/useDpTaskCenter';
import { DpTaskState } from '@/common/contracts/dp-task';
import type { YoutubeImportTaskResult } from '@/common/contracts/youtube-import';
import { youtubeImportApi } from './youtubeImportApi';
import { parsePercent, parseTaskResult } from './youtubeImportTaskUtil';

interface YoutubeImportTaskRowProps {
    /** 任务中心里的后台任务编号。 */
    taskId: number;
    /** 用户点击「去播放」时触发。 */
    onPlay: (result: YoutubeImportTaskResult) => void;
}

/**
 * 单条导入任务的进度行：进度文本、百分比条与终态展示，弹窗与空库主视觉共用。
 */
const YoutubeImportTaskRow = ({ taskId, onPlay }: YoutubeImportTaskRowProps) => {
    const { t } = useTranslation('youtubeImport');
    // 只订阅本任务的对象引用：任务中心任意任务 tick 重建 Map，但不改变未更新任务的对象，
    // Object.is 比较跳过，避免整表订阅让所有行跟着别人的进度重渲染
    const task = useDpTaskCenter((state) => state.tasks.get(taskId));
    const taskView = task && task !== 'init' ? task : null;
    const percent = taskView ? parsePercent(taskView.progress) : null;
    const result = taskView ? parseTaskResult(taskView) : null;
    const isDone = taskView?.status === DpTaskState.DONE;
    const isFailed = taskView?.status === DpTaskState.FAILED;
    const isCancelled = taskView?.status === DpTaskState.CANCELLED;
    return (
        <div className="rounded-xl border border-border/70 p-3 flex flex-col gap-1.5">
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
                            onClick={() => onPlay(result)}
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
};

export default YoutubeImportTaskRow;
