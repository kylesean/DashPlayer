import type { DpTask } from '@/common/contracts/dp-task';
import type { YoutubeImportTaskResult } from '@/common/contracts/youtube-import';

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
