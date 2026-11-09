/**
 * 播放器侧栏滚动的跨边界协议常量。
 *
 * 为什么放在 `src/common`：这些字符串同时被三方使用——
 * 1. 产品代码（`Subtitle.tsx` 把它们挂到 DOM 上，`scrollWriteLog.ts` 用它们找容器）；
 * 2. e2e 用例（`qa/specs/player/*` 用它们定位元素）；
 * 3. 机读出口（`qa/tools/check-player-scroll.mjs` 用观测前缀切分日志）。
 *
 * 此前它们散在 `dev/scrollWriteLog.ts`、`Subtitle.tsx` 的字符串字面量与
 * `qa/support/scroll-anchor-protocol.ts` 的三份副本里，任何一处改名都不会让另一处报错，
 * 只会让 e2e 静默定位不到元素（而 e2e 不进 CI，没人会发现）。收敛成一份后，
 * 改名会在 `tsc` 阶段直接失败。
 *
 * 约束：本文件必须保持**零 import 的纯常量**。`.mjs` 工具会用 Node 的类型擦除直接
 * `import()` 它，任何相对导入都会因为没有扩展名而解析失败（Node 的 ESM 解析规则）。
 */

/** 侧栏滚动容器的稳定 testid。 */
export const PLAYER_SIDEBAR_SCROLLER_TESTID = 'player-sidebar-scroller';

/** 字幕行的稳定 testid（行上另带 `data-index` / `data-current`）。 */
export const SENTENCE_CARD_TESTID = 'sentence-card';

/** 「侧栏译文」开关的稳定 testid（状态只认 `aria-pressed`）。 */
export const SIDE_TRANSLATION_TOGGLE_TESTID = 'side-translation-toggle';

/**
 * 滚动锚定观测行的日志前缀。
 *
 * 用例先把每轮结果 `console.log` 成一行 JSON，机读工具按这个前缀切分；
 * 两边共用同一个常量，避免「改了前缀 → 工具识别到 0 条观测」被误报成空通过。
 */
export const PLAYER_SCROLL_OBSERVATION_PREFIX = '[player-scroll-anchor] ';
