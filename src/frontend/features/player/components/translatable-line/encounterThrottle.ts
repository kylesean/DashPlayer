/**
 * 单词遭遇事件的本地节流器。
 *
 * 悬停与打开浮层都可能高频触发，但只有第一次接触携带学习信号；
 * 这里用纯模块状态做时间窗判定，避免在 React 渲染路径里读时钟或 ref。
 */
export type EncounterThrottleAction = 'hover' | 'open';

const WINDOWS_MS: Record<EncounterThrottleAction, number> = {
    hover: 60_000,
    open: 5_000,
};

const lastAtByKey = new Map<string, number>();

/**
 * 判断一次遭遇是否应该上报。
 *
 * @param action 遭遇动作。
 * @param key 稳定去重键；悬停按词与句，打开按词。
 * @param now 当前毫秒时间戳，默认取系统时钟。
 * @returns 落在节流窗口外时返回 `true`，并记录本次时间。
 */
export const shouldRecordEncounter = (
    action: EncounterThrottleAction,
    key: string,
    now = Date.now(),
): boolean => {
    const mapKey = `${action}:${key}`;
    const lastAt = lastAtByKey.get(mapKey);
    if (lastAt !== undefined && now - lastAt < WINDOWS_MS[action]) {
        return false;
    }
    lastAtByKey.set(mapKey, now);
    return true;
};

/**
 * 清空节流状态；仅用于测试隔离。
 */
export const resetEncounterThrottle = (): void => {
    lastAtByKey.clear();
};
