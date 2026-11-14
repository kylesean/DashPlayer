import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { type DpTask, isTerminalDpTaskState } from '@/common/contracts/dp-task';
import { emptyFunc } from '@/common/utils/Util';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import { backendClient } from '@/frontend/infrastructure/electron/backendClient';
import { rendererEvents } from '@/frontend/infrastructure/electron/rendererEvents';

const api = backendClient;

/** 后台任务缓存状态。 */
type UseDpTaskCenterState = {
    tasks: Map<number, DpTask | 'init'>;
};

/** 任务注册回调配置。 */
type DpTaskConfig = {
    /** 任务结束（完成、失败或取消）时触发。 */
    onFinish?: (task: DpTask) => void;
    /** 任务状态每次推送更新时触发。 */
    onUpdated?: (task: DpTask) => void;
};

/** 后台任务中心操作方法。 */
type UseDpTaskCenterStateAction = {
    /** 创建并追踪后端异步任务，返回任务 ID。 */
    register(func: () => Promise<number>, config?: DpTaskConfig): Promise<number>;
    /** 拉取尚未缓存的任务初始状态，不重复发起请求。 */
    tryRegister(taskId: number): void;
};

/**
 * 合并推送或拉取到的后台任务状态：终态一旦落定，不允许被非终态覆盖。
 */
export function mergeIncomingDpTask(
    existing: DpTask | 'init' | undefined,
    incoming: DpTask,
): DpTask {
    if (
        existing
        && existing !== 'init'
        && isTerminalDpTaskState(existing.status)
        && !isTerminalDpTaskState(incoming.status)
    ) {
        return existing;
    }
    return incoming;
}

/**
 * 判断初始详情快照是否应写入缓存：若 `onTaskUpdate` 已在途中推来更新的实时状态，
 * 只允许终态快照补位，避免旧快照把在途进度覆盖回去。
 */
export function shouldApplyDetailSnapshot(
    existing: DpTask | 'init' | undefined,
    snapshot: DpTask,
): boolean {
    if (existing === undefined || existing === 'init') {
        return true;
    }
    return !isTerminalDpTaskState(existing.status) && isTerminalDpTaskState(snapshot.status);
}

/**
 * 统一登记和追踪后端异步任务，让前端不同页面共享同一份任务状态。
 */
const useDpTaskCenter = create(
    subscribeWithSelector<UseDpTaskCenterState & UseDpTaskCenterStateAction>((set, get) => ({
        tasks: new Map(),
        register: async (func, config) => {
            const taskId = await func();

            const onUpdated = config?.onUpdated ?? emptyFunc;
            const onFinish = config?.onFinish ?? emptyFunc;

            if (config?.onFinish || config?.onUpdated) {
                let settled = false;
                let unsubscribe: (() => void) | null = null;

                const deliver = (task: DpTask) => {
                    if (settled) return;
                    onUpdated(task);
                    if (isTerminalDpTaskState(task.status)) {
                        settled = true;
                        unsubscribe?.();
                        unsubscribe = null;
                        onFinish(task);
                    }
                };

                // 先挂订阅再检查当前态与拉取详情，消除「极快任务在订阅前已终态导致丢回调/泄漏」的窗口。
                unsubscribe = useDpTaskCenter.subscribe(
                    (state) => state.tasks.get(taskId),
                    (task) => {
                        if (task && task !== 'init') {
                            deliver(task);
                        }
                    },
                );

                const current = get().tasks.get(taskId);
                if (current && current !== 'init') {
                    deliver(current);
                }

                if (!settled) {
                    void get().tryRegister(taskId);
                }
            } else {
                void get().tryRegister(taskId);
            }

            return taskId;
        },
        tryRegister: async (taskId) => {
            const existing = get().tasks.get(taskId);
            if (existing && existing !== 'init') return existing as DpTask;
            if (existing === 'init') return null;

            set((state) => {
                if (state.tasks.has(taskId)) return state;
                return { tasks: new Map(state.tasks).set(taskId, 'init') };
            });
            try {
                const task = await api.call('dp-task/detail', taskId);
                if (!task) {
                    getRendererLogger('useDpTaskCenter').warn('task not found, removing from cache', { taskId });
                    set((state) => {
                        if (state.tasks.get(taskId) !== 'init') return state;
                        const newTasks = new Map(state.tasks);
                        newTasks.delete(taskId);
                        return { tasks: newTasks };
                    });
                    return null;
                }
                set((state) => {
                    const current = state.tasks.get(taskId);
                    if (!shouldApplyDetailSnapshot(current, task)) {
                        return state;
                    }
                    return { tasks: new Map(state.tasks).set(taskId, task) };
                });
                return get().tasks.get(taskId) as DpTask | null;
            } catch (error) {
                getRendererLogger('useDpTaskCenter').error('failed to fetch initial task state', { taskId, error });
                set((state) => {
                    if (state.tasks.get(taskId) !== 'init') return state;
                    const newTasks = new Map(state.tasks);
                    newTasks.delete(taskId);
                    return { tasks: newTasks };
                });
                return null;
            }
        },
    })),
);

export default useDpTaskCenter;

let cleanupListener: (() => void) | null = null;

/**
 * 启动后台任务状态变更的全局 IPC 监听。
 */
export const startListeningToDpTasks = () => {
    if (!cleanupListener) {
        cleanupListener = rendererEvents.onTaskUpdate((updatedTask: DpTask) => {
            if (!updatedTask || !updatedTask.id) return;
            useDpTaskCenter.setState((state) => {
                const current = state.tasks.get(updatedTask.id);
                const merged = mergeIncomingDpTask(current, updatedTask);
                if (merged === current) return state;
                return { tasks: new Map(state.tasks).set(updatedTask.id, merged) };
            });
        });
    }
};

/**
 * 停止后台任务状态变更监听并释放订阅句柄。
 */
export const stopListeningToDpTasks = () => {
    if (cleanupListener) {
        cleanupListener();
        cleanupListener = null;
    }
};

