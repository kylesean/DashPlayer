/**
 * 侧栏「保持阅读位置」的纯换算：根据布局变化前后的两份快照，算出该把滚动位置写到哪。
 *
 * 为什么单独抽成纯函数：这套换算以前写在组件里，一边读 DOM 一边改 scrollTop，
 * 与 Virtuoso 的分批重测抢同一个位置，实测落点从偏 36px 到偏 428px 都有。
 * 现在换算与写入彻底分离——纯函数只回答「目标是多少」，写不写、写几轮由调用方决定。
 *
 * 坐标约定（务必分清）：
 * - `top` 是**布局像素**，基准是滚动容器可视区顶边（不是视口、不是内容顶部）；
 * - `scrollTop` 也是布局像素（Chromium 下 `scrollTop` 与 `offsetTop` 同为单位）；
 * - `getBoundingClientRect()` 给的是**视觉像素**，容器被 CSS transform 缩放时必须先换算。
 */

/**
 * 锚点快照：靠 data index 标识一行字幕，而不是 DOM 节点（虚拟列表会回收节点）。
 *
 * `top` 为该行顶边到滚动容器可视区顶边的距离（布局像素，可为负）。
 */
export type AnchorSample = { index: number; top: number } | null;

/** 换算所需的两份快照：布局变化前 / 布局变化后。 */
export interface ScrollTargetInput {
    /** 变化前的快照：滚动位置与锚点行位置。 */
    before: { scrollTop: number; anchor: AnchorSample };
    /**
     * 变化后的快照：**当前**滚动位置与锚点行位置。
     *
     * 这里的 `scrollTop` 是换算基准，不能省成 `before.scrollTop`：
     * 锚点的位移是在「当前滚动位置」下测出来的，而 Virtuoso 在行高重测期间会自己改
     * `scrollTop`（实测切换一次从 900 漂到 1178）。若仍以 `before.scrollTop` 为基准，
     * 就等于把这段漂移重复计入一次，写入值在 920 / 1172 之间来回摆，残差
     * 13.7 → 271.8 → 19.5 → 265.9 一路发散，跑满轮次也到不了 1px 以内。
     *
     * 注意「基准取当前」与「每轮重算、不累加上一轮 delta」并不矛盾：
     * 位移永远由 `before.anchor.top` 与**当前实测**的 `after.anchor.top` 现算，
     * 不含任何历史 delta；换的只是这段位移该加到哪个滚动位置上。
     */
    after: { scrollTop: number; anchor: AnchorSample };
}

/** 换算选项。 */
export interface ScrollTargetOptions {
    /** 单步允许的最大位移（布局像素），默认 400；用于把一次跳变拆成多轮小步。 */
    maxStepPx?: number;
}

/** 单步位移的默认上限（布局像素）。 */
export const DEFAULT_MAX_STEP_PX = 400;

/**
 * 计算「让锚点行保持原位置」所需的滚动位置。
 *
 * 判定与失败语义：
 * - 任一快照的锚点缺失，或两次锚点不是同一行（index 不同）→ 返回 null，
 *   调用方**不许滚**（fail closed）：锚不住就别乱动，宁可不调也不能把用户顶到别处；
 * - `maxStepPx` 夹住单步幅度，正负两侧都夹；
 * - 结果不会为负（滚动位置下限为 0）。
 *
 * @param input 变化前后的两份快照。
 * @param opts 换算选项。
 * @returns 目标滚动位置；无法锚定时返回 null。
 */
export function computeScrollTarget(
    input: ScrollTargetInput,
    opts?: ScrollTargetOptions,
): { scrollTop: number } | null {
    const { before, after } = input;
    const beforeAnchor = before.anchor;
    const afterAnchor = after.anchor;

    if (!beforeAnchor || !afterAnchor) {
        return null;
    }
    if (beforeAnchor.index !== afterAnchor.index) {
        return null;
    }
    if (!Number.isFinite(before.scrollTop)
        || !Number.isFinite(beforeAnchor.top)
        || !Number.isFinite(afterAnchor.top)) {
        return null;
    }

    const maxStepPx = opts?.maxStepPx ?? DEFAULT_MAX_STEP_PX;
    if (!Number.isFinite(maxStepPx) || maxStepPx <= 0) {
        return null;
    }

    // 行相对**当前滚动位置**移动了多少，滚动位置就跟着移动多少，锚点才会停在原处。
    // 用 after.scrollTop 而不是 before.scrollTop：见 ScrollTargetInput.after 的说明——
    // 重测期间容器自己已经漂过一段，那一段必须计入基准，否则会被重复补偿。
    const shiftPx = afterAnchor.top - beforeAnchor.top;
    const clampedShift = Math.max(-maxStepPx, Math.min(maxStepPx, shiftPx));

    return { scrollTop: Math.max(0, after.scrollTop + clampedShift) };
}
