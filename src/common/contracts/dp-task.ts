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
 * 这份清单是「任务是否结束」的唯一真相。后端落库时机、前端任务中心订阅释放
 * 等判定都依赖它；各写一份布尔表达式时，新增终态（例如未来的 `expired`）只要漏改一处，
 * 就会出现任务永远转圈或订阅器不释放。
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
 * 结构化进度元数据：阶段 code 由前端映射为本地化文案。
 *
 * 仅用于内存与 IPC 传递，不写入数据库（dp_task 表无对应列），因此不构成
 * 跨进程持久化契约；需要跨重启保留的进度仍应写 `progress`。
 */
export interface DpTaskProgressMeta {
    /** 稳定阶段 code，例如 `downloading`。 */
    code: string;
    /** 当前阶段百分比（0-100）；无进度概念的阶段省略。 */
    percent?: number;
    /** 文案插值参数。 */
    params?: Record<string, string | number>;
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
    /** 结构化进度元数据；仅内存/IPC 传递，不落库。 */
    progressMeta?: DpTaskProgressMeta | null;
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
