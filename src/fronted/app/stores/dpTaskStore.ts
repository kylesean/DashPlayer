import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { type DpTask, isTerminalDpTaskState } from '@/common/contracts/dp-task';
import { emptyFunc } from '@/common/utils/Util';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import { rendererEvents } from '@/fronted/infrastructure/electron/rendererEvents';

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
 * 统一登记和追踪后端异步任务，让前端不同页面共享同一份任务状态。
 */
const useDpTaskCenter = create(
    subscribeWithSelector<UseDpTaskCenterState & UseDpTaskCenterStateAction>((set, get) => ({
        tasks: new Map(),
        register: async (func, config) => {
            const taskId = await func();
            get().tryRegister(taskId);

            const onUpdated = config?.onUpdated ?? emptyFunc;
            const onFinish = config?.onFinish ?? emptyFunc;

            if (config?.onFinish || config?.onUpdated) {
                const unsubscribe = useDpTaskCenter.subscribe(
                    (state) => state.tasks.get(taskId),
                    (task) => {
                        if (task && task !== 'init') {
                            onUpdated(task);

                            if (isTerminalDpTaskState(task.status)) {
                                onFinish(task);
                                unsubscribe();
                            }
                        }
                    },
                );
            }

            return taskId;
        },
        tryRegister: async (taskId) => {
            const existing = get().tasks.get(taskId);
            if (existing && existing !== 'init') return existing as DpTask;
            if (existing === 'init') return null;

            set((state) => ({ tasks: new Map(state.tasks).set(taskId, 'init') }));
            try {
                const task = await api.call('dp-task/detail', taskId);
                if (!task) {
                    getRendererLogger('useDpTaskCenter').warn('task not found, removing from cache', { taskId });
                    set((state) => {
                        const newTasks = new Map(state.tasks);
                        newTasks.delete(taskId);
                        return { tasks: newTasks };
                    });
                    return null;
                }
                set((state) => ({ tasks: new Map(state.tasks).set(taskId, task) }));
                return task;
            } catch (error) {
                getRendererLogger('useDpTaskCenter').error('failed to fetch initial task state', { taskId, error });
                set((state) => {
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
            useDpTaskCenter.setState((state) => ({
                tasks: new Map(state.tasks).set(updatedTask.id, updatedTask),
            }));
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

