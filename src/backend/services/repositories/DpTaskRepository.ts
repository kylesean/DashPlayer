import { type DpTask, DpTaskState, type DpTaskUpdate } from '@/common/contracts/dp-task';

/**
 * 创建后台任务时允许由业务层提供的字段。
 */
export type CreateDpTaskParams = Pick<DpTaskUpdate, 'status' | 'progress' | 'result'> & {
    status?: DpTaskState;
};

/**
 * 更新后台任务时允许写入的字段。
 */
export type DpTaskUpdatePatch = Pick<DpTaskUpdate, 'status' | 'progress' | 'result' | 'updated_at'>;

/**
 * 后台任务持久化端口。
 */
export default interface DpTaskRepository {
    findById(id: number): Promise<DpTask | null>;
    create(params: CreateDpTaskParams): Promise<DpTask>;
    updateById(id: number, patch: DpTaskUpdatePatch): Promise<void>;
    cancelAllActive(): Promise<void>;

    /**
     * 删除早于给定截止时间的终态任务。
     *
     * 只有成功、失败、取消三类终态任务会被删除；活动任务（待处理、处理中）
     * 永不参与删除，避免把正在执行的任务记录抹掉。
     *
     * @param cutoff 截止时间，数据库 UTC 时间字符串（`YYYY-MM-DD HH:mm:ss`）。
     * @returns 被删除的行数。
     */
    deleteTerminalBefore(cutoff: string): Promise<number>;
}
