/**
 * 播放页的「当前视图」。
 *
 * 此前这个状态被拆成三个互不相识的布尔值：
 * `chatStore.learningVisible`、`practiceStore.visible`、`layoutStore.podcastMode`。
 * 互斥规则由每个入口各自记住「打开自己时顺手关掉别人」来维持，
 * 于是任何新入口（快捷键、自动切换、以后可能的新面板）只要漏配对，
 * 就会得到一个「两层同时可见」或「状态为真但被上层盖住」的界面。
 *
 * 已确认的真实故障：播客层是 `z-30` 全屏覆盖，学习页在 `z-20`，
 * 而学习快捷键不受播客模式限制。播客模式下按学习键会暂停播放、
 * `learningVisible` 变 true，但页面被播客层盖住——用户看到的是「播放莫名停了」。
 */
export type PlayerViewMode = 'play' | 'learning' | 'practice' | 'podcast';

/**
 * 三个历史字段的组合快照。
 *
 * 保留这三个字段而不是换成一个枚举，是为了不动 UI 与 store 的对外形状；
 * 它们由 {@link viewModeFlags} 统一写入，不再是各自独立的真相。
 */
export interface PlayerViewFlags {
    learningVisible: boolean;
    practiceVisible: boolean;
    podcastMode: boolean;
}

/**
 * 各视图对应的字段取值。
 *
 * 这是唯一一份「打开某个视图时，另外两个必须是什么」的定义。
 *
 * @param mode 目标视图。
 * @returns 该视图下三个字段的取值。
 */
export function viewModeFlags(mode: PlayerViewMode): PlayerViewFlags {
    return {
        learningVisible: mode === 'learning',
        practiceVisible: mode === 'practice',
        podcastMode: mode === 'podcast',
    };
}

/**
 * 从三个字段推导实际可见的视图。
 *
 * 优先级按「谁盖在谁上面」排序，而不是按用户操作顺序：
 * 播客是全屏覆盖层，只要它为真，用户实际看到的就是播客，即使学习页也处于可见状态。
 * 这个顺序让「同时为真」的非法组合退化成可解释的结果，而不是取决于渲染顺序。
 *
 * @param flags 三个字段的当前取值。
 * @returns 用户实际看到的视图。
 */
export function derivePlayerViewMode(flags: PlayerViewFlags): PlayerViewMode {
    if (flags.podcastMode) {
        return 'podcast';
    }
    if (flags.practiceVisible) {
        return 'practice';
    }
    if (flags.learningVisible) {
        return 'learning';
    }
    return 'play';
}

/**
 * 判断三个字段是否处于非法组合（同时有多个视图为真）。
 *
 * 供测试与诊断日志使用：正常流程下应恒为 false。
 *
 * @param flags 三个字段的当前取值。
 * @returns 存在互斥冲突时返回 true。
 */
export function hasPlayerViewConflict(flags: PlayerViewFlags): boolean {
    const activeCount = Number(flags.learningVisible)
        + Number(flags.practiceVisible)
        + Number(flags.podcastMode);
    return activeCount > 1;
}

/**
 * 解析「点击某个开关」之后应该切到哪个视图。
 *
 * 同一个按钮在两种视图下含义不同，这里把它写成纯函数：
 * 当前已在该视图时点击表示退出（回到 `play`），否则表示进入该视图。
 *
 * @param current 当前实际可见的视图。
 * @param target 被点击的视图开关。
 * @returns 切换后的视图。
 */
export function resolveViewToggle(
    current: PlayerViewMode,
    target: Exclude<PlayerViewMode, 'play'>
): PlayerViewMode {
    return current === target ? 'play' : target;
}

/**
 * 判断某个视图开关在给定视图下是否应显示为「激活」。
 *
 * @param current 当前实际可见的视图。
 * @param target 被检查的视图开关。
 * @returns 该开关是否处于激活态。
 */
export function isViewToggleActive(
    current: PlayerViewMode,
    target: Exclude<PlayerViewMode, 'play'>
): boolean {
    return current === target;
}
