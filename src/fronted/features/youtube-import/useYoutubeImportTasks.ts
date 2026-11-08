import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useSWRConfig } from 'swr';
import { apiPath } from '@/fronted/lib/swr-util';
import { fileBrowserApi } from '@/fronted/features/file-browser/fileBrowserApi';
import useDpTaskCenter from '@/fronted/hooks/useDpTaskCenter';
import { DpTaskState } from '@/common/contracts/dp-task';
import type { DpTask } from '@/common/contracts/dp-task';
import type { YoutubeImportTaskResult } from '@/common/contracts/youtube-import';
import { youtubeImportApi } from './youtubeImportApi';
import { isFinalTaskState, parseTaskResult } from './youtubeImportTaskUtil';

interface UseYoutubeImportTasksOptions {
    /** 返回 false 时跳过自动跳转（如弹窗已关闭后任务才结束）；缺省恒允许。 */
    canAutoJump?: () => boolean;
    /** 自动或手动跳转播放前触发，用于关闭承载导入 UI 的弹窗。 */
    onBeforeJump?: () => void;
}

/**
 * YouTube 导入任务的共享编排：发起导入、订阅任务进度、成功后刷新视频库缓存，
 * 并在本组件登记的全部任务结束时自动跳转最近一个成功入库的视频——
 * 「检索精选内容 → 沉浸学习」动线的核心一跳。
 */
const useYoutubeImportTasks = (options: UseYoutubeImportTasksOptions = {}) => {
    const navigate = useNavigate();
    const { mutate } = useSWRConfig();
    const [url, setUrl] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [taskIds, setTaskIds] = React.useState<number[]>([]);

    // 任务中心订阅回调闭包固定于注册时刻，经 ref 读取最新登记列表与守卫；
    // 赋值放 effect,避免渲染期写 ref
    const taskIdsRef = React.useRef<number[]>([]);
    useEffect(() => {
        taskIdsRef.current = taskIds;
    }, [taskIds]);
    const canAutoJumpRef = React.useRef(options.canAutoJump);
    const onBeforeJumpRef = React.useRef(options.onBeforeJump);
    useEffect(() => {
        canAutoJumpRef.current = options.canAutoJump;
        onBeforeJumpRef.current = options.onBeforeJump;
    }, [options.canAutoJump, options.onBeforeJump]);

    const playVideo = React.useCallback(async (result: YoutubeImportTaskResult) => {
        onBeforeJumpRef.current?.();
        await fileBrowserApi.changeWindowSize('player');
        navigate(`/player/${result.videoId}`);
    }, [navigate]);

    const tryAutoJump = React.useCallback(() => {
        if (canAutoJumpRef.current && !canAutoJumpRef.current()) return;
        const ids = taskIdsRef.current;
        if (ids.length === 0) return;
        const latest = useDpTaskCenter.getState().tasks;
        const states = ids.map((id) => latest.get(id));
        // 还有任务未到终态时不动，等最后一个任务结束再统一决策。
        if (states.some((task) => !task || task === 'init' || !isFinalTaskState(task))) return;
        // taskIds 新→旧排列，取最近一个成功且带视频结果的任务；全部失败则不跳。
        const winner = states
            .filter((task): task is DpTask => Boolean(task) && task !== 'init' && (task as DpTask).status === DpTaskState.DONE)
            .map(parseTaskResult)
            .find((result) => result?.videoId);
        if (winner) void playVideo(winner);
    }, [playVideo]);

    const startImport = async () => {
        const trimmed = url.trim();
        if (!trimmed || submitting) return;
        setSubmitting(true);
        try {
            const taskId = await useDpTaskCenter.getState().register(
                () => youtubeImportApi.start(trimmed).then((result) => result.taskId),
                {
                    onFinish: (task) => {
                        // 导入成功后刷新首页的观看历史缓存，新视频立刻出现在列表里。
                        if (task.status === DpTaskState.DONE) {
                            void mutate(apiPath('watch-history/list/basic'));
                            void mutate(apiPath('watch-history/list'));
                        }
                        tryAutoJump();
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

    return { url, setUrl, submitting, taskIds, startImport, playVideo };
};

export default useYoutubeImportTasks;
