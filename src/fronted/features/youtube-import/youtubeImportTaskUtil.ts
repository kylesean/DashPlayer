import { DpTaskState } from '@/common/contracts/dp-task';
import type { DpTask } from '@/common/contracts/dp-task';
import type { YoutubeImportTaskResult } from '@/common/contracts/youtube-import';

/**
 * 从任务进度文本中解析下载百分比；无百分比时返回 null。
 */
export const parsePercent = (progress: string | null): number | null => {
    if (!progress) return null;
    const match = /(\d+(?:\.\d+)?)%/.exec(progress);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
};

/**
 * 解析任务结果中的入库视频信息；结果缺失或格式不对时返回 null。
 */
export const parseTaskResult = (task: DpTask): YoutubeImportTaskResult | null => {
    if (!task.result) return null;
    try {
        return JSON.parse(task.result) as YoutubeImportTaskResult;
    } catch {
        return null;
    }
};

/**
 * 任务是否已到达终态（成功/失败/取消），判定口径与任务中心订阅逻辑一致。
 */
export const isFinalTaskState = (task: DpTask): boolean =>
    task.status === DpTaskState.DONE ||
    task.status === DpTaskState.FAILED ||
    task.status === DpTaskState.CANCELLED;
