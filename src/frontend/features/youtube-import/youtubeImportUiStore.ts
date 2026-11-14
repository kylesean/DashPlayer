import { create } from 'zustand';
import { mutate } from 'swr';
import i18n from '@/frontend/i18n';
import { apiPath } from '@/frontend/lib/swr-util';
import useDpTaskCenter from '@/frontend/app/stores/dpTaskStore';
import { showNotification } from '@/frontend/components/shared/toasts/notification';
import { DpTaskState, isTerminalDpTaskState, type DpTask } from '@/common/contracts/dp-task';
import { parseYoutubeVideoId } from '@/common/utils/youtubeUrl';
import type { YoutubeImportTaskResult } from '@/common/contracts/youtube-import';
import { youtubeImportApi } from './youtubeImportApi';

/** 一次导入提交在界面上的身份信息：任务编号、原始 URL 与解析出的视频 ID。 */
export interface YoutubeImportTaskEntry {
    taskId: number;
    url: string;
    videoId: string;
    createdAt: number;
}

/**
 * YouTube 导入的全局状态与唯一业务入口。
 *
 * 弹窗、首页 Hero、顶部按钮与侧栏入口都只读写这里，避免各自持有一份任务列表
 * 导致「一个入口在下载、另一个入口看不到」。导航不在 store 内完成：这里只写出
 * `playTarget`，由常驻的 YoutubeImportDialogHost 统一执行跳转。
 */
type YoutubeImportState = {
    /** 导入弹窗是否打开。 */
    open: boolean;
    /** 输入框草稿；两个入口共享。 */
    url: string;
    /** 是否正在提交新的导入任务（防重复提交）。 */
    submitting: boolean;
    /** 本次会话的任务行，新任务在前。 */
    tasks: YoutubeImportTaskEntry[];
    /** 待执行的播放跳转；由 Host 消费后清空。 */
    playTarget: YoutubeImportTaskResult | null;
    setOpen: (open: boolean) => void;
    setUrl: (url: string) => void;
    /** 提交一条导入；`rawUrl` 用于失败重试。 */
    startImport: (rawUrl?: string) => Promise<void>;
    /** 用失败任务保留的 URL 重新提交。 */
    retryTask: (taskId: number) => Promise<void>;
    /** 请求打开播放页；实际导航由 Host 完成。 */
    requestPlay: (result: YoutubeImportTaskResult) => void;
    /** Host 完成导航后清空跳转目标。 */
    consumePlay: () => void;
};

/** 任务是否仍在进行（含尚未拿到初始状态的任务）。 */
const isTaskActive = (taskId: number): boolean => {
    const task = useDpTaskCenter.getState().tasks.get(taskId);
    return !task || task === 'init' || !isTerminalDpTaskState(task.status);
};

/** 去掉协议前缀，作为任务行的可读身份。 */
const displayIdentity = (url: string): string => url.replace(/^https?:\/\//, '');

const useYoutubeImportUi = create<YoutubeImportState>((set, get) => {
    /** 任务结束时的缓存刷新与后台提示（不跳转）。 */
    const handleFinish = (task: DpTask, url: string): void => {
        if (task.status === DpTaskState.DONE) {
            // 导入成功后刷新首页的观看历史缓存，新视频立刻出现在列表里。
            void mutate(apiPath('watch-history/list/basic'));
            void mutate(apiPath('watch-history/list'));
        }
        // 弹窗开着时用户能直接看到行内状态，不再重复弹提示。
        if (get().open) return;
        if (task.status === DpTaskState.DONE) {
            showNotification({
                variant: 'success',
                message: i18n.t('youtubeImport:notify.done', { identity: displayIdentity(url) }),
            });
        } else if (task.status === DpTaskState.FAILED) {
            showNotification({
                variant: 'error',
                message: i18n.t('youtubeImport:notify.failed', { identity: displayIdentity(url) }),
            });
        }
    };

    return {
        open: false,
        url: '',
        submitting: false,
        tasks: [],
        playTarget: null,

        setOpen: (open) => {
            if (open) {
                set({ open: true });
                return;
            }
            // 关闭时清掉已完成的任务行：再次打开不会再看到上一批结果，
            // 进行中的任务保留，用户重开后仍能继续取消或查看进度。
            set((state) => ({
                open: false,
                tasks: state.tasks.filter((entry) => isTaskActive(entry.taskId)),
            }));
        },

        setUrl: (url) => set({ url }),

        startImport: async (rawUrl) => {
            const state = get();
            const url = (rawUrl ?? state.url).trim();
            if (!url || state.submitting) return;
            const videoId = parseYoutubeVideoId(url);
            if (!videoId) return;
            const duplicated = state.tasks.some(
                (entry) => entry.videoId === videoId && isTaskActive(entry.taskId),
            );
            if (duplicated) {
                showNotification({ variant: 'warning', message: i18n.t('youtubeImport:notify.duplicate') });
                return;
            }

            set({ submitting: true });
            try {
                const taskId = await useDpTaskCenter.getState().register(
                    () => youtubeImportApi.start(url).then((result) => result.taskId),
                    { onFinish: (task) => handleFinish(task, url) },
                );
                set((current) => ({
                    submitting: false,
                    // 手动重试时保留输入框草稿，正常提交后清空以便连续导入。
                    url: rawUrl === undefined ? '' : current.url,
                    tasks: [{ taskId, url, videoId, createdAt: Date.now() }, ...current.tasks],
                }));
            } catch (error) {
                set({ submitting: false });
                showNotification({
                    variant: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },

        retryTask: async (taskId) => {
            const entry = get().tasks.find((item) => item.taskId === taskId);
            if (!entry) return;
            await get().startImport(entry.url);
        },

        requestPlay: (result) => set({ playTarget: result }),

        consumePlay: () => set({ playTarget: null }),
    };
});

export default useYoutubeImportUi;
