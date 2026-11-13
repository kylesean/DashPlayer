import { toast } from 'react-hot-toast';
import { create } from 'zustand';
import { type DpTask, DpTaskState, isTerminalDpTaskState } from '@/common/contracts/dp-task';
import useDpTaskCenter from '@/fronted/app/stores/dpTaskStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { playerApi } from '@/fronted/features/player/playerApi';

export type SubtitleGenerationMessages = {
    done: string;
    formatFailed: (message: string) => string;
};

type SubtitleGenerationState = {
    taskIdsByVideo: Record<string, number>;
    startingVideos: Record<string, boolean>;
    cancellingVideos: Record<string, boolean>;
    start: (videoId: string, messages: SubtitleGenerationMessages) => Promise<void>;
    cancel: (videoId: string, formatFailed: (message: string) => string) => Promise<void>;
};

const clearVideoEntry = (
    state: SubtitleGenerationState,
    videoId: string,
): Partial<SubtitleGenerationState> => {
    const nextTasks = { ...state.taskIdsByVideo };
    const nextStarting = { ...state.startingVideos };
    const nextCancelling = { ...state.cancellingVideos };
    delete nextTasks[videoId];
    delete nextStarting[videoId];
    delete nextCancelling[videoId];
    return {
        taskIdsByVideo: nextTasks,
        startingVideos: nextStarting,
        cancellingVideos: nextCancelling,
    };
};

/**
 * 按视频 ID 维度追踪字幕生成后台任务：
 * 切走再切回同一视频可恢复进度与取消入口；旧视频任务完成时绝不篡改当前已切换到的新视频会话。
 */
export const useSubtitleGenerationStore = create<SubtitleGenerationState>((set, get) => ({
    taskIdsByVideo: {},
    startingVideos: {},
    cancellingVideos: {},

    start: async (videoId, messages) => {
        if (!videoId) return;
        const current = get();
        if (current.startingVideos[videoId] || current.taskIdsByVideo[videoId] !== undefined) {
            return;
        }

        set((state) => ({
            startingVideos: { ...state.startingVideos, [videoId]: true },
        }));

        try {
            const id = await useDpTaskCenter.getState().register(
                () => playerApi.startSubtitleGeneration(videoId),
                {
                    onFinish: (task: DpTask) => {
                        set((state) => clearVideoEntry(state, videoId));

                        if (task.status === DpTaskState.DONE) {
                            toast.success(messages.done);
                            // 只有用户仍停留在该视频上时才解析路径并重载字幕；切去别的视频绝不能覆盖新会话。
                            if (usePlaybackSession.getState().videoId !== videoId) {
                                return;
                            }
                            void (async () => {
                                try {
                                    const resolution = await playerApi.getPlayerSubtitle(videoId);
                                    if (usePlaybackSession.getState().videoId !== videoId) {
                                        return;
                                    }
                                    if (resolution.subtitlePath) {
                                        usePlaybackSession.getState().updateFile(resolution.subtitlePath);
                                    }
                                    usePlaybackSession.getState().reloadSubtitles();
                                } catch (error) {
                                    toast.error(messages.formatFailed(
                                        error instanceof Error ? error.message : String(error),
                                    ));
                                }
                            })();
                            return;
                        }

                        if (task.status === DpTaskState.FAILED) {
                            toast.error(messages.formatFailed(String(task.result ?? '')));
                        }
                    },
                },
            );

            // 若任务在 register 返回前已秒级进入终态，不要再把已结束的 taskId 写回活跃映射。
            const latestTask = useDpTaskCenter.getState().tasks.get(id);
            if (latestTask && latestTask !== 'init' && isTerminalDpTaskState(latestTask.status)) {
                set((state) => clearVideoEntry(state, videoId));
                return;
            }

            set((state) => {
                const nextStarting = { ...state.startingVideos };
                delete nextStarting[videoId];
                return {
                    startingVideos: nextStarting,
                    taskIdsByVideo: { ...state.taskIdsByVideo, [videoId]: id },
                };
            });
        } catch (error) {
            set((state) => clearVideoEntry(state, videoId));
            toast.error(messages.formatFailed(
                error instanceof Error ? error.message : String(error),
            ));
        }
    },

    cancel: async (videoId, formatFailed) => {
        if (!videoId) return;
        const { taskIdsByVideo, cancellingVideos } = get();
        const taskId = taskIdsByVideo[videoId];
        if (taskId === undefined || cancellingVideos[videoId]) {
            return;
        }
        set((state) => ({
            cancellingVideos: { ...state.cancellingVideos, [videoId]: true },
        }));
        try {
            await playerApi.cancelSubtitleGeneration(taskId);
        } catch (error) {
            toast.error(formatFailed(
                error instanceof Error ? error.message : String(error),
            ));
        } finally {
            // 取消请求已收尾（无论成败）即清掉取消中标记。成功路径此前依赖任务随后的
            // FINISH 广播收尾，终态通知一旦丢失，取消按钮会永久停留在"取消中"。
            set((state) => {
                if (!(videoId in state.cancellingVideos)) {
                    return state;
                }
                const next = { ...state.cancellingVideos };
                delete next[videoId];
                return { cancellingVideos: next };
            });
        }
    },
}));
