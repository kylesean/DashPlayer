import { getMainLogger } from '@/backend/infrastructure/logger';
import { type DpTask, DpTaskState, type DpTaskUpdate, isTerminalDpTaskState } from '@/common/contracts/dp-task';
import { LRUCache } from 'lru-cache';
import TimeUtil from '@/common/utils/TimeUtil';
import { inject, injectable } from 'inversify';
import type { Cancelable } from '@/common/interfaces';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import TYPES from '@/backend/ioc/types';
import type DpTaskRepository from '@/backend/services/repositories/DpTaskRepository';
import { type DpTaskUpdatePatch } from '@/backend/services/repositories/DpTaskRepository';
import type RendererEvents from '@/backend/services/gateways/renderer/RendererEvents';
import { concurrency } from '@/backend/utils/concurrency';

/**
 * 终态任务保留时长：7 天。
 *
 * 终态任务（成功、失败、取消）只用于回溯执行结果，保留一周足够排查问题；
 * 再久只是让 dp_task 表无限膨胀，没有任何收益。
 */
const TERMINAL_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 机会式清理的最小间隔：1 小时。
 *
 * 清理本身很轻，但没必要在每次任务落库时都跑一遍；限流后长会话里
 * 最多每小时清理一次，任务表不会无界增长。
 */
const TERMINAL_TASK_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 后台任务业务服务。
 */
export default interface DpTaskService {
    detail(id: number): Promise<DpTask | null>;

    create(): Promise<number>;

    update(task: DpTaskUpdate): void;

    process(id: number, info: DpTaskUpdate): void;

    finish(id: number, info: DpTaskUpdate): void;

    fail(id: number, info: DpTaskUpdate): void;

    cancel(id: number): void;

    checkCancel(id: number): void;

    registerTask(taskId: number, process: Cancelable): void;

    /**
     * 应用启动时将数据库中遗留的活动任务统一标记为已取消。
     */
    recoverInterruptedTasks(): Promise<void>;

    /**
     * 删除超过保留期的终态任务；活动任务不受影响。
     */
    cleanupExpiredTasks(): Promise<void>;
}


/**
 * 尚未落库的任务更新。
 *
 * 同一任务的多次更新按调用顺序合并，后一次字段覆盖前一次字段。
 */
type PendingTaskUpdate = DpTaskUpdatePatch;

/**
 * 后台任务业务服务实现。
 */
@injectable()
export class DpTaskServiceImpl implements DpTaskService {
    private logger = getMainLogger('DpTaskServiceImpl');
    /** 等待合并落库的任务更新。 */
    private readonly pendingUpdates = new Map<number, PendingTaskUpdate>();
    /** 当前是否已有落库消费者在执行。 */
    private isFlushingUpdates = false;
    /** 当前刷写结束后是否需要立即处理新到达的结束状态。 */
    private shouldFlushImmediately = false;
    /** 普通进度更新的合并等待计时器。 */
    private flushTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly cancelQueue = new Set<number>();
    private readonly cache: LRUCache<number, DpTaskUpdate> = new LRUCache({
        maxSize: 2000,
        sizeCalculation: () => {
            return 1;
        }
    });
    private readonly taskMapping = new Map<number, Cancelable[]>();
    /** 上次发起终态任务清理的时刻；用于把清理频率限制在每小时一次以内。 */
    private lastCleanupAt = 0;

    /**
     * 构造后台任务业务服务。
     *
     * @param rendererEvents 渲染进程事件推送端口。
     * @param dpTaskRepository 后台任务仓储。
     */
    constructor(
        @inject(TYPES.RendererEvents) private readonly rendererEvents: RendererEvents,
        @inject(TYPES.DpTaskRepository) private readonly dpTaskRepository: DpTaskRepository,
    ) {}

    /**
     * 将任务最新状态通知给渲染进程。
     *
     * @param taskId 任务编号。
     */
    private notify(taskId: number): void {
        this.detail(taskId)
            .then(task => {
                if (task) {
                    this.rendererEvents.dpTaskUpdate(task);
                }
            })
            .catch(error => {
                this.logger.error('failed to notify task update', { taskId, error });
            });
    }

    public async detail(id: number): Promise<DpTask | null> {

        if (this.cache.has(id)) {
            this.logger.debug('returning cached task', { taskId: id });
            const cached = this.cache.get(id);
            if (cached) {
                return this.toDpTask(cached);
            }
        }

        return await this.dpTaskRepository.findById(id);
    }

    /**
     * 把缓存里的增量更新补成完整的 `DpTask`。
     *
     * 缓存类型是 `DpTaskUpdate`（部分字段），直接 `as DpTask` 会让刚创建、还没被
     * 更新过的任务缺 `result` 键——运行时是 undefined，而跨进程契约要求 `string | null`。
     * 任何 `result === null` 的判断都会因此失配。
     *
     * @param update 缓存中的任务增量。
     * @returns 补齐可选字段后的任务详情。
     */
    private toDpTask(update: DpTaskUpdate): DpTask {
        return {
            id: update.id as number,
            status: update.status as DpTaskState,
            progress: update.progress ?? null,
            result: update.result ?? null,
            created_at: update.created_at as string,
            updated_at: update.updated_at as string,
        };
    }


    public async create(): Promise<number> {
        const task = await this.dpTaskRepository.create({
            status: DpTaskState.INIT,
            progress: '任务创建成功',
        });
        const taskId = task.id;
        this.cache.set(taskId, {
            id: taskId,
            status: DpTaskState.INIT,
            progress: '任务创建成功',
            result: null,
            created_at: TimeUtil.timeUtc(),
            updated_at: TimeUtil.timeUtc()
        });
        this.notify(taskId);
        return taskId;
    }


    /**
     * 合并任务更新，并按状态决定延迟或立即写入数据库。
     *
     * @param task 本次需要更新的字段，必须包含任务编号。
     */
    public update(task: DpTaskUpdate): void {
        if (task.id === undefined || task.id === null) {
            return;
        }
        const isFinal = this.isFinalState(task.status);
        if (isFinal) {
            this.taskMapping.delete(task.id);
            this.cancelQueue.delete(task.id);
        }
        const updatedTask = {
            ...task,
            updated_at: TimeUtil.timeUtc(),
        };
        if (this.cache.has(task.id)) {
            this.cache.set(task.id, {
                ...this.cache.get(task.id),
                ...updatedTask,
            });
        }
        this.mergePendingUpdate(task.id, updatedTask);
        this.scheduleUpdateFlush(isFinal);
        this.notify(task.id);
    }

    /**
     * 标记任务进入处理中状态。
     *
     * @param id 任务编号。
     * @param info 进度或结果补充信息。
     */
    public process(id: number, info: DpTaskUpdate) {
        const task: DpTaskUpdate = {
            id,
            status: DpTaskState.IN_PROGRESS,
        };
        this.updateTaskInfo(task, info);
        this.update(task);
    }

    /**
     * 标记任务成功完成。
     *
     * @param id 任务编号。
     * @param info 最终进度或结果。
     */
    public finish(id: number, info: DpTaskUpdate) {
        const task: DpTaskUpdate = {
            id,
            status: DpTaskState.DONE,
        };
        this.updateTaskInfo(task, info);
        this.update(task);
        // 最终结果只在这一行完整记录（日志系统会按单行 800 字上限兜底），逐 chunk 更新不记。
        this.logger.info('task finished', { taskId: id, result: info.result ?? null });
    }

    /**
     * 标记任务执行失败。
     *
     * @param id 任务编号。
     * @param info 失败结果或进度说明。
     */
    public fail(id: number, info: DpTaskUpdate) {
        const task: DpTaskUpdate = {
            id,
            status: DpTaskState.FAILED,
        };
        this.updateTaskInfo(task, info);
        this.update(task);
        this.logger.info('task failed', { taskId: id, result: info.result ?? null });
    }

    /**
     * 将调用方提供的进度和结果写入任务更新对象。
     *
     * @param task 将被更新的任务。
     * @param info 调用方提供的补充字段。
     */
    private updateTaskInfo(task: DpTaskUpdate, info: DpTaskUpdate): void {
        if (info.progress !== undefined) {
            // 进度更新频率高，降为 debug 避免刷屏。
            this.logger.debug('task progress updated', { taskId: task.id, progress: info.progress });
            task.progress = info.progress;
        }
        if (info.result !== undefined) {
            task.result = info.result;
        }
    }

    /**
     * 请求取消任务及其已注册的可取消操作。
     *
     * @param id 任务编号。
     */
    public cancel(id: number): void {
        const cached = this.cache.get(id);
        if (cached && this.isFinalState(cached.status)) {
            return;
        }
        this.logger.info('task cancel requested', { taskId: id });
        this.cancelQueue.add(id);
        const cancelable = this.taskMapping.get(id);
        if (cancelable) {
            cancelable.forEach(c => {
                c.cancel();
            });
        }
    }

    /**
     * 在任务执行过程中检查是否已收到取消请求。
     *
     * @param id 任务编号。
     * @throws {CancelByUserError} 用户已取消任务时抛出。
     */
    public checkCancel(id: number): void {
        if (this.cancelQueue.has(id)) {
            this.logger.info('task cancel confirmed', { taskId: id });
            this.update({
                id,
                status: DpTaskState.CANCELLED,
                progress: '任务取消'
            });
            throw new CancelByUserError();
        }
    }

    /**
     * 合并同一任务的待落库字段。
     *
     * @param taskId 任务编号。
     * @param update 待合并字段。
     */
    private mergePendingUpdate(taskId: number, update: PendingTaskUpdate): void {
        this.pendingUpdates.set(taskId, {
            ...this.pendingUpdates.get(taskId),
            ...update,
        });
    }

    /**
     * 判断任务状态是否需要立即持久化。
     *
     * @param state 待判断的数据库任务状态。
     * @returns 任务结束状态时返回 `true`。
     */
    private isFinalState(state: string | undefined): boolean {
        return isTerminalDpTaskState(state);
    }

    /**
     * 安排一次合并后的任务状态落库。
     *
     * 结束状态立即请求刷写；普通进度更新只等待短暂时间以合并高频调用。
     *
     * @param immediately 是否跳过等待立即刷写。
     */
    private scheduleUpdateFlush(immediately = false): void {
        if (this.isFlushingUpdates) {
            this.shouldFlushImmediately = this.shouldFlushImmediately || immediately;
            return;
        }
        if (immediately) {
            if (this.flushTimer) {
                clearTimeout(this.flushTimer);
                this.flushTimer = undefined;
            }
            void this.flushPendingUpdates();
            return;
        }
        if (this.isFlushingUpdates || this.flushTimer) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.flushPendingUpdates();
        }, 300);
    }

    /**
     * 顺序写入当前待处理更新。
     *
     * 刷写期间新到达的更新保留在原队列中；写入失败的项目会合并回队列并在稍后重试。
     */
    private async flushPendingUpdates(): Promise<void> {
        if (this.isFlushingUpdates || this.pendingUpdates.size === 0) {
            return;
        }

        this.isFlushingUpdates = true;
        const updates = Array.from(this.pendingUpdates.entries());
        this.pendingUpdates.clear();

        try {
            for (let index = 0; index < updates.length; index++) {
                const [taskId, update] = updates[index];
                try {
                    await this.dpTaskRepository.updateById(taskId, update);
                } catch (error) {
                    const newer = this.pendingUpdates.get(taskId);
                    this.pendingUpdates.set(taskId, { ...update, ...newer });
                    for (const [remainingTaskId, remainingUpdate] of updates.slice(index + 1)) {
                        const newerRemaining = this.pendingUpdates.get(remainingTaskId);
                        this.pendingUpdates.set(remainingTaskId, { ...remainingUpdate, ...newerRemaining });
                    }
                    this.logger.error('任务状态写入失败，将在稍后重试', { taskId, error });
                    return;
                }
            }
            // 有任务落库后顺带清理过期终态任务，长会话里任务表不会无界增长。
            this.maybeCleanupExpiredTasks();
        } finally {
            this.isFlushingUpdates = false;
            if (this.pendingUpdates.size > 0) {
                const immediately = this.shouldFlushImmediately;
                this.shouldFlushImmediately = false;
                this.scheduleUpdateFlush(immediately);
            }
        }
    }

    /**
     * 应用启动时取消数据库中遗留的活动任务。
     */
    public async recoverInterruptedTasks(): Promise<void> {
        this.logger.info('cancel all active tasks on startup');
        await this.dpTaskRepository.cancelAllActive();
    }

    /**
     * 删除超过保留期的终态任务；应用启动时调用一次。
     */
    public async cleanupExpiredTasks(): Promise<void> {
        this.lastCleanupAt = Date.now();
        await this.runTerminalTaskCleanup();
    }

    /**
     * 删除早于保留期截止点的终态任务。
     *
     * 互斥锁保证启动清理与机会式清理不会并发跑；活动任务由仓储的状态白名单挡住。
     *
     * 这里跳过内核的锁顺序校验：清理可能由任务落库触发，而任务落库可能发生在
     * 资源信号量上下文里（例如 yt-dlp 下载过程中更新任务进度），
     * 按“互斥锁必须先于信号量获取”的规则会被判成违规。
     * 清理本身是叶子操作：只删一行数据，不再获取任何锁，不存在死锁风险。
     */
    private async runTerminalTaskCleanup(): Promise<void> {
        await concurrency.withMutex('dp-task-cleanup', async () => {
            const cutoff = TimeUtil.dateToUtc(new Date(Date.now() - TERMINAL_TASK_RETENTION_MS));
            const removed = await this.dpTaskRepository.deleteTerminalBefore(cutoff);
            if (removed > 0) {
                this.logger.info('expired terminal tasks pruned', { removed, cutoff });
            }
        }, { skipOrderCheck: true });
    }

    /**
     * 任务落库后机会式触发清理；距上次清理不足一小时时直接跳过。
     *
     * 失败只记日志：清理是后台维护动作，不能影响任务本身的写入与状态流转。
     */
    private maybeCleanupExpiredTasks(): void {
        const now = Date.now();
        if (now - this.lastCleanupAt < TERMINAL_TASK_CLEANUP_INTERVAL_MS) {
            return;
        }
        this.lastCleanupAt = now;
        void this.runTerminalTaskCleanup().catch((error) => {
            this.logger.error('expired task cleanup failed', { error });
        });
    }

    /**
     * 注册与任务生命周期绑定的可取消操作。
     *
     * 终态（成功/失败/已取消）或已进入取消队列的任务会立即取消新注册的操作，
     * 且不会将其写入 taskMapping，防止进程与闭包内存泄漏。
     *
     * @param taskId 任务编号。
     * @param process 可取消操作。
     */
    public registerTask(taskId: number, process: Cancelable): void {
        const cached = this.cache.get(taskId);
        const pendingStatus = this.pendingUpdates.get(taskId)?.status;
        if (
            (cached && this.isFinalState(cached.status)) ||
            (pendingStatus && this.isFinalState(pendingStatus))
        ) {
            this.logger.debug('process registered to already terminated task, cancelling immediately', { taskId });
            process.cancel();
            return;
        }
        if (this.cancelQueue.has(taskId)) {
            process.cancel();
            return;
        }
        const existingProcesses = this.taskMapping.get(taskId) || [];
        this.taskMapping.set(taskId, [...existingProcesses, process]);
    }

}
