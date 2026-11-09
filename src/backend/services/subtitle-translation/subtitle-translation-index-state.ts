/**
 * 单个字幕稳定坐标在一次翻译会话中的状态。
 *
 * 此前调度器用 `completedIndices` / `deadIndices` / `inFlightIndices` 三个集合并集
 * 反推同一件事，任何新增失败路径只要漏掉一次集合清理，坐标就会永久卡在「在途」
 * 而不再被调度，且这种漏清理不会抛错、只会静默少翻译。这里把「一个坐标只能处于
 * 一种状态」写成显式枚举，写入点从三处收敛到一处。
 *
 * `queued` 不落库：Map 中不存在该坐标即表示待调度，避免为整份字幕预填空状态。
 */
export type SubtitleIndexState = 'queued' | 'in-flight' | 'completed' | 'dead';

export type SubtitleIndexStateMap = ReadonlyMap<number, SubtitleIndexState>;

/**
 * 读取坐标状态；未记录即视为待调度。
 *
 * @param states 当前会话的坐标状态表。
 * @param index 字幕稳定坐标。
 * @returns 该坐标当前状态。
 */
export function getIndexState(
    states: SubtitleIndexStateMap,
    index: number
): SubtitleIndexState {
    return states.get(index) ?? 'queued';
}

/**
 * 判断坐标是否还能被分配给新批次。
 *
 * @param states 当前会话的坐标状态表。
 * @param index 字幕稳定坐标。
 * @returns 仅在待调度时返回 true。
 */
export function isIndexSchedulable(
    states: SubtitleIndexStateMap,
    index: number
): boolean {
    return getIndexState(states, index) === 'queued';
}

/**
 * 从候选坐标中挑出仍可调度的部分，保持原有顺序。
 *
 * @param states 当前会话的坐标状态表。
 * @param indices 候选坐标。
 * @returns 可调度坐标。
 */
export function collectSchedulableIndices(
    states: SubtitleIndexStateMap,
    indices: readonly number[]
): number[] {
    return indices.filter((index) => isIndexSchedulable(states, index));
}

/**
 * 把一批坐标标记为在途。
 *
 * @param states 当前会话的坐标状态表。
 * @param indices 被批次认领的坐标。
 */
export function markIndicesInFlight(
    states: Map<number, SubtitleIndexState>,
    indices: readonly number[]
): void {
    indices.forEach((index) => states.set(index, 'in-flight'));
}

/**
 * 把一批坐标标记为完成。
 *
 * @param states 当前会话的坐标状态表。
 * @param indices 已产出译文的坐标。
 */
export function markIndicesCompleted(
    states: Map<number, SubtitleIndexState>,
    indices: readonly number[]
): void {
    indices.forEach((index) => states.set(index, 'completed'));
}

/**
 * 把一批坐标标记为死信。
 *
 * @param states 当前会话的坐标状态表。
 * @param indices 重试次数耗尽的坐标。
 */
export function markIndicesDead(
    states: Map<number, SubtitleIndexState>,
    indices: readonly number[]
): void {
    indices.forEach((index) => states.set(index, 'dead'));
}

/**
 * 批次收尾时释放在途占位。
 *
 * 只回退仍处于 `in-flight` 的坐标：同一批次可能已经把部分坐标标成 `completed`
 * 或 `dead`，无条件删除会把终态打回待调度，造成重复翻译或死信复活。
 *
 * @param states 当前会话的坐标状态表。
 * @param indices 该批次认领过的坐标。
 */
export function releaseInFlightIndices(
    states: Map<number, SubtitleIndexState>,
    indices: readonly number[]
): void {
    indices.forEach((index) => {
        if (states.get(index) === 'in-flight') {
            states.delete(index);
        }
    });
}

/**
 * 批次失败后的处置方式。
 *
 * - `ignore`：本次没有需要重试的坐标。
 * - `dropped`：批次已离开当前窗口，不再重试（结果已写缓存）。
 * - `dead-letter`：重试次数耗尽，剩余坐标不再重试。
 * - `requeue`：回到当前窗口队列等待下一轮。
 */
export type FailedBatchOutcome = 'ignore' | 'dropped' | 'dead-letter' | 'requeue';

export interface FailedBatchInput {
    /** 本次仍需要重试的坐标数量。 */
    retryableCount: number;
    /** 批次起点是否仍在当前窗口内。 */
    inCurrentWindow: boolean;
    /** 该批次已经重新入队的次数。 */
    requeueCount: number;
    /** 允许的最大重新入队次数。 */
    maxRequeueCount: number;
}

/**
 * 判定失败批次的去向。
 *
 * 判定顺序本身就是产品决策：先看还有没有要重试的坐标，再看是否离开窗口，
 * 最后才看重试次数。因此「已耗尽重试次数但已经离开窗口」的批次会被记为
 * `dropped` 而不是 `dead-letter`，与现有观测口径保持一致。
 *
 * @param input 失败批次的当前处境。
 * @returns 处置方式。
 */
export function decideFailedBatchOutcome(input: FailedBatchInput): FailedBatchOutcome {
    if (input.retryableCount <= 0) {
        return 'ignore';
    }
    if (!input.inCurrentWindow) {
        return 'dropped';
    }
    if (input.requeueCount >= input.maxRequeueCount) {
        return 'dead-letter';
    }
    return 'requeue';
}
