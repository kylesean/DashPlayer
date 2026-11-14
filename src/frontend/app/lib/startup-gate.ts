/**
 * 迁移失败详情的最小约束。
 *
 * 只要求 `failed`，其余字段由调用方的真实类型补全，
 * 这样启动门槛的纯逻辑不必依赖后端完整契约。
 */
export interface StartupMigrationFailure {
    failed: boolean;
}

/**
 * 启动门槛的裁决结果。
 *
 * `null` 表示两个门槛都还没读出结果，界面应展示加载指示。
 */
export type StartupGate<TFailure extends StartupMigrationFailure = StartupMigrationFailure> =
    | { kind: 'migration-failure'; failure: TFailure }
    | { kind: 'onboarding' }
    | { kind: 'main' };

/**
 * 裁决启动时应该进入哪个界面。
 *
 * 优先级是一条**产品决策**，此前只存在于 `useEffect` 里两个相邻的 `if`：
 * 迁移失败必须先让用户处理，否则「数据迁移没跑完」的用户会被引导流程
 * 直接带进主界面，看起来一切正常但历史数据是坏的。
 * 引导只拦从未完成过的用户；已完成过任意版本的引导直接进主界面。
 *
 * 单次读取失败按「该门槛不拦截」处理（调用方把失败降级为 `null`）：
 * 一次 IPC 异常不该把用户永久锁在启动页。
 *
 * @param failure 迁移失败详情；`null` 表示读取失败或没有失败。
 * @param completedVersion 已完成的引导版本；`null` 或空串表示从未完成。
 * @returns 应进入的启动界面。
 */
export function resolveStartupGate<TFailure extends StartupMigrationFailure>(
    failure: TFailure | null,
    completedVersion: string | null
): StartupGate<TFailure> {
    if (failure?.failed) {
        return { kind: 'migration-failure', failure };
    }
    return completedVersion ? { kind: 'main' } : { kind: 'onboarding' };
}
