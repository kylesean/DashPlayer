/**
 * 设置页自动保存的显式状态。
 *
 * 此前「是否脏 / 是否在飞 / 是否已排队」是三个互相独立的 ref，
 * 只能在脑中模拟才能回答「现在按下关闭会发生什么」。
 */
export type AutoSavePhase =
    /** 已初始化且与服务端一致，没有待保存改动。 */
    | 'idle'
    /** 有未保存改动，防抖计时中。 */
    | 'dirty'
    /** 保存请求在途。 */
    | 'saving'
    /** 在途期间又有新改动，本轮结束后必须再存一次。 */
    | 'saving-dirty'
    /** 上一次保存失败，改动仍然保留。 */
    | 'error';

/**
 * 驱动状态机的输入。
 */
export interface AutoSaveSnapshot {
    /** 表单当前值是否与服务端基线不同。 */
    dirty: boolean;
    /** 是否有保存请求在途。 */
    inFlight: boolean;
    /** 是否有保存失败的改动尚未重试成功。 */
    failed: boolean;
}

/**
 * 由三个事实推导当前阶段。
 *
 * 顺序本身就是语义：失败优先于在途与脏（失败后必须让用户看到），
 * 在途且有脏表示「本轮结束后还要再存一次」。
 *
 * @param snapshot 当前事实。
 * @returns 自动保存阶段。
 */
export function deriveAutoSavePhase(snapshot: AutoSaveSnapshot): AutoSavePhase {
    if (snapshot.failed) {
        return 'error';
    }
    if (snapshot.inFlight) {
        return snapshot.dirty ? 'saving-dirty' : 'saving';
    }
    return snapshot.dirty ? 'dirty' : 'idle';
}

/**
 * 判断在途保存结束后是否必须再提交一次。
 *
 * @param phase 本轮结束时的阶段。
 * @returns 需要补一次提交时返回 true。
 */
export function shouldCommitAgain(phase: AutoSavePhase): boolean {
    return phase === 'saving-dirty';
}

/**
 * 判断是否允许用服务端快照重置表单。
 *
 * 这是本模块最重要的规则：保存成功后 hook 会 `mutate` 详情缓存，
 * 设置页随之把新快照交回 `initialize`。若此时用户已经在输入下一个改动，
 * 无条件 `reset()` 会**把用户刚敲的字擦掉**——表现为「打字打到一半被回退」。
 *
 * 首次初始化必须放行（`ready === false`）：那时表单还是 `useForm` 的
 * 默认空值，与任何真实快照都不相等，拦掉会让页面永远停在加载态。
 * 初始化之后，只有「本地就是服务端快照」或「本地没有未保存改动」时才允许重置。
 *
 * 真实的丢字时序（必须挡住）：用户输入 b → 保存 b 在途 → 用户继续输入 c
 * → 保存 b 成功、基线推进到 b → mutate 重取返回 b → 若此时直接 reset(b)，
 * 用户刚敲的 c 就被擦掉了。判据是「本地当前值既不是 b、也不是基线」，
 * 也就是存在未保存改动。
 *
 * @param ready 是否已完成首次初始化。
 * @param localSnapshot 当前表单值快照。
 * @param baselineSnapshot 上一次与服务端对齐时的快照；未初始化时为 null。
 * @param incomingSnapshot 即将应用的服务端快照。
 * @returns 可以重置时返回 true。
 */
export function canApplyServerSnapshot(
    ready: boolean,
    localSnapshot: string,
    baselineSnapshot: string | null,
    incomingSnapshot: string
): boolean {
    if (!ready) {
        return true;
    }
    // 本地已经是目标值：重置是空操作，放行无害。
    if (localSnapshot === incomingSnapshot) {
        return true;
    }
    // 本地没有未保存改动：接受服务端刷新（切走再切回、后台重新校验）。
    return localSnapshot === baselineSnapshot;
}
