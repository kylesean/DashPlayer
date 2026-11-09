/**
 * 播放器「句末行为」模式的显式状态机。
 *
 * 背景：句末行为原本由 `autoPause` / `singleRepeat` / `shadowing` / `sentenceLoop`
 * 四个字段共同表达，互斥规则散落在各个 setter 里，靠「顺手把别人置 false」维持。
 * 这种写法有两个问题：
 * - 规则只存在于调用点，新增入口（如 `repeatCurrent`）很容易绕过，留下「两个模式同时为真」的脏状态；
 * - UI 与订阅方无法判断当前到底是哪个模式，只能各自组合布尔值。
 *
 * 这里把「同一时刻只能有一个持久句末模式」这条不变量收敛成纯函数：
 * 不读写 store、不产生副作用，便于单测与复用。`sentenceLoop` 在 store 里是对象
 * （携带遍数、倍速与基准倍速），因此以布尔参数 `loopActive` 参与判定。
 *
 * 注意：`hoverRepeat`（悬停临时循环）不属于本状态机。它是叠加在持久模式之上的
 * 瞬态覆盖层，鼠标离开即还原，不参与互斥。
 */

/** 持久句末模式；`off` 表示不启用任何句末行为。 */
export type SentenceEndMode =
    | 'off'
    | 'autoPause'
    | 'singleRepeat'
    | 'shadowing'
    | 'sentenceLoop';

/** 可被本状态机直接开关的三种布尔模式。 */
export type SentenceEndBooleanMode = Exclude<SentenceEndMode, 'off' | 'sentenceLoop'>;

/** 句末模式的布尔标志集合。 */
export interface SentenceEndModeFlags {
    /** 句末自动暂停。 */
    autoPause: boolean;
    /** 单句（或整组）循环。 */
    singleRepeat: boolean;
    /** 影子跟读留白。 */
    shadowing: boolean;
}

/**
 * 多个标志同时为真时的裁决顺序。
 *
 * 正常情况下永远只有一个为真；这里给历史脏状态一个确定答案，
 * 避免不同订阅方对「当前模式」得出不同结论。
 */
const MODE_PRIORITY: SentenceEndBooleanMode[] = ['shadowing', 'singleRepeat', 'autoPause'];

/**
 * 由标志推导当前生效的持久句末模式。
 *
 * @param flags 句末模式布尔标志。
 * @param loopActive 常开逐句循环是否开启。
 * @returns 当前生效模式；无任何模式时为 `off`。
 */
export function deriveSentenceEndMode(
    flags: SentenceEndModeFlags,
    loopActive: boolean,
): SentenceEndMode {
    if (loopActive) {
        return 'sentenceLoop';
    }
    for (const mode of MODE_PRIORITY) {
        if (flags[mode]) {
            return mode;
        }
    }
    return 'off';
}

/**
 * 是否处于「非法」的多模式并存状态。
 *
 * 只用于开发期诊断与测试断言，不参与运行时逻辑。
 *
 * @param flags 句末模式布尔标志。
 * @param loopActive 常开逐句循环是否开启。
 * @returns 同时启用的模式超过一个时返回 true。
 */
export function hasSentenceEndModeConflict(
    flags: SentenceEndModeFlags,
    loopActive: boolean,
): boolean {
    const enabledCount = MODE_PRIORITY.filter((mode) => flags[mode]).length + (loopActive ? 1 : 0);
    return enabledCount > 1;
}

/**
 * 互斥地启用一个布尔句末模式：其余布尔模式全部关闭。
 *
 * @param mode 要启用的模式。
 * @returns 仅该模式为真的标志集合。
 */
export function enableSentenceEndMode(mode: SentenceEndBooleanMode): SentenceEndModeFlags {
    return {
        autoPause: mode === 'autoPause',
        singleRepeat: mode === 'singleRepeat',
        shadowing: mode === 'shadowing',
    };
}

/**
 * 关闭一个布尔句末模式，其余模式保持不变。
 *
 * 与 `enableSentenceEndMode` 不对称是刻意的：关闭某个模式不应顺手打开别的模式。
 *
 * @param flags 当前标志。
 * @param mode 要关闭的模式。
 * @returns 关闭后的标志集合。
 */
export function disableSentenceEndMode(
    flags: SentenceEndModeFlags,
    mode: SentenceEndBooleanMode,
): SentenceEndModeFlags {
    return { ...flags, [mode]: false };
}

/**
 * 切换一个布尔句末模式：已开启则关闭，未开启则互斥启用。
 *
 * @param flags 当前标志。
 * @param mode 要切换的模式。
 * @returns 切换后的标志集合。
 */
export function toggleSentenceEndMode(
    flags: SentenceEndModeFlags,
    mode: SentenceEndBooleanMode,
): SentenceEndModeFlags {
    return flags[mode] ? disableSentenceEndMode(flags, mode) : enableSentenceEndMode(mode);
}

/**
 * 关闭全部布尔句末模式。
 *
 * @returns 全部为 false 的标志集合。
 */
export function clearSentenceEndModes(): SentenceEndModeFlags {
    return { autoPause: false, singleRepeat: false, shadowing: false };
}
