/**
 * 后台任务状态。
 */
export enum DpTaskState {
    INIT = 'init',
    IN_PROGRESS = 'in_progress',
    DONE = 'done',
    CANCELLED = 'cancelled',
    FAILED = 'failed',
}

/**
 * 终态任务状态：任务到达这些状态后不会再发生变化。
 *
 * 这份清单是「任务是否结束」的唯一真相。后端落库时机、前端任务中心订阅释放、
 * YouTube 导入的批量跳转判定都依赖它；三处各写一份布尔表达式时，
 * 新增终态（例如未来的 `expired`）只要漏改一处，就会出现任务永远转圈或订阅器不释放。
 */
export const TERMINAL_DP_TASK_STATES: readonly DpTaskState[] = [
    DpTaskState.DONE,
    DpTaskState.FAILED,
    DpTaskState.CANCELLED,
];

/**
 * 判断任务状态是否为终态。
 *
 * @param state 待判断的任务状态；允许传入尚未确定状态的 `undefined`。
 * @returns 属于终态时返回 `true`。
 */
export function isTerminalDpTaskState(state: DpTaskState | string | undefined | null): boolean {
    if (!state) {
        return false;
    }
    return (TERMINAL_DP_TASK_STATES as readonly string[]).includes(state);
}

/**
 * 跨进程传输的后台任务详情。
 */
export interface DpTask {
    /** 数据库任务编号。 */
    id: number;
    /** 当前任务状态。 */
    status: DpTaskState;
    /** 面向用户的进度描述。 */
    progress: string | null;
    /** 任务结果序列化文本。 */
    result: string | null;
    /** UTC 创建时间。 */
    created_at: string;
    /** UTC 更新时间。 */
    updated_at: string;
}

/**
 * 后端更新任务时使用的字段集合。
 */
export type DpTaskUpdate = Partial<DpTask>;
