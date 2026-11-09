/**
 * 首页窗口模式异步收尾的结局。
 *
 * 这段逻辑原本只有两个 `if`：观测到非设计尺寸就让路，锁死后被改尺寸就撤销锁死。
 * 三种结局（锁死 / 一开始就让路 / 锁死后让路）都只体现在日志字符串里，
 * 既没法被测试断言，也没法在调用方区分——新增窗口管理器适配时只能靠读日志猜。
 */
export type HomeWindowOutcome =
    /** 几何由应用主导：窗口被锁在设计尺寸且未被覆盖。 */
    | 'locked'
    /** 窗口管理器在管几何：不请求尺寸，直接让路。 */
    | 'yielded-size'
    /** 锁死之后窗口管理器才把尺寸摆走：撤销锁死让路。 */
    | 'yielded-late-resize'
    /** 等待期间状态被新的切换请求作废，或窗口已销毁。 */
    | 'aborted';

/**
 * 尺寸相等判定。
 *
 * 单独抽出来是因为这里有语义：Wayland 下 Electron 会把自己请求的尺寸原样回读，
 * 所以「相等」只代表「没有证据表明窗口管理器在管几何」，不代表请求已落地。
 *
 * @param observed 观测到的尺寸。
 * @param expected 设计尺寸。
 * @returns 两个维度都相等时返回 true。
 */
export function isHomeSize(
    observed: readonly [number, number],
    expected: readonly [number, number]
): boolean {
    return observed[0] === expected[0] && observed[1] === expected[1];
}

/**
 * 在发出任何 setSize 之前决定：锁死还是让路。
 *
 * 顺序很重要——这个判定必须发生在 setSize 之前。setSize 之后
 * `getSize` / `getContentSize` / 渲染进程视口都会变成请求值，
 * 「请求是否落地」就再也观测不到了。
 *
 * @param observed 稳定后的尺寸。
 * @param expected 首页设计尺寸。
 * @returns `lock` 表示由应用主导几何；`yield-size` 表示窗口管理器在管。
 */
export function decideHomePlacement(
    observed: readonly [number, number],
    expected: readonly [number, number]
): 'lock' | 'yield-size' {
    return isHomeSize(observed, expected) ? 'lock' : 'yield-size';
}

/**
 * 锁死并观察一段时间后，决定是否撤销锁死。
 *
 * 迟到的 configure 意味着窗口管理器才是几何的主导者：此时必须释放
 * `setResizable(false)`，否则窗口会被设计尺寸钉住，用户拉不动也最大化不了。
 *
 * @param overridden 观察期内是否观测到尺寸被改成设计尺寸之外的值。
 * @returns 最终结局。
 */
export function decideLockedOutcome(overridden: boolean): HomeWindowOutcome {
    return overridden ? 'yielded-late-resize' : 'locked';
}
