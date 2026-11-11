/**
 * 侧栏滚动锚定回归用例：切换「侧栏译文」后，正在读的那一行必须留在原处。
 *
 * 背景（为什么这条用例值得存在）：切换译文会让每一行的高度变化，滚动位置却还是原来那个数字，
 * 内容整体位移几十到几百像素，用户得自己找回位置。修法是「hold 意图」——
 * 先等布局稳定，再用锚点算出目标 scrollTop，逐轮逼近。这条用例就是那套逻辑的门：
 *
 * - 策略 a（默认）：补偿生效，末轮残差 < 1 布局像素，且请求类滚动写入 ≤ 3 次；
 * - 策略 b（对照）：整套补偿被关掉，请求类滚动写入必须为 0（证明残差归零确实是这套逻辑干的）；
 * - 锚点行被虚拟列表回收时：守卫不成立（用例记为红），并且一次都不许滚（fail closed）。
 *
 * 策略由进程环境变量 `DP_POLICY` 决定（a / b），进页面后注入 renderer 的
 * `window.__dpPolicy`；应用侧只认这个内存开关，不读环境变量、不落盘，因此不会变成产品开关。
 *
 * 说明：所有结果先 `console.log` 一段 JSON 再断言——断言失败会吞掉后续日志，
 * 先打印才能拿到失败现场（首轮 scrollTop、内容高变化、残差、请求数、是否收敛）。
 */
import { expect, type Page } from '@playwright/test';
import { test } from '../../support/fixtures';
import path from 'node:path';
import {
    FLING_TO_END_WHEEL_DELTA,
    MIN_CONTENT_HEIGHT_DELTA,
    MIN_START_SCROLL_TOP,
    ROUNDS,
    START_SCROLL_TOP,
} from '../../support/scroll-anchor-protocol';
// 元素标识是产品与用例共用的运行期契约，唯一来源在 src/common（改名会在 tsc 阶段失败）
import {
    PLAYER_SIDEBAR_SCROLLER_TESTID as SCROLLER_TESTID,
    PLAYER_SCROLL_OBSERVATION_PREFIX as OBSERVATION_PREFIX,
    SENTENCE_CARD_TESTID,
    SIDE_TRANSLATION_TOGGLE_TESTID as SIDE_TRANSLATION_TESTID,
} from '../../../src/common/constants/player-scroll-protocol';

/** 夹具：36 句双语字幕 + 同目录同名视频（由 qa/fixtures/make-fixtures.mjs 生成，不入库）。 */
const FIXTURE_VIDEO = path.join(__dirname, '..', '..', 'fixtures', 'media', 'qa-bilingual.mp4');

/** 本轮使用的策略：a = hold，b = 对照。 */
const POLICY: 'a' | 'b' = process.env.DP_POLICY === 'b' ? 'b' : 'a';

/**
 * 本文件用例的超时预算（毫秒）。
 *
 * 全局超时是 60 秒，但这里的最坏耗时明显更长：`openPlayer` 里等字幕行最多 30 秒、
 * 等滚动静稳最多 15 秒；每轮还要等 hold（预置 8 秒 + 正式 10 秒）、钉起点最多 3.2 秒，
 * 三轮合计约 66 秒。加起来最坏能到 110 秒以上——用默认值会让「超时」先于断言触发，
 * 失败信息指向时间而不是残差，把排查方向带偏。
 */
const PLAYER_TEST_TIMEOUT_MS = 180_000;

/** 一次采样：滚动位置、内容高度、最上方可见行。 */
interface ScrollSample {
    scrollTop: number;
    contentHeight: number;
    /** 最上方可见行的 data index 与其到容器顶的距离（布局像素）；没有可见行为 null。 */
    anchor: { index: number; top: number } | null;
    /** 当前渲染出来的字幕行数量。 */
    renderedCards: number;
    /** 容器可视高度（布局像素）。 */
    clientHeight: number;
}

/** 一轮的观测结果（会整段打印成 JSON）。 */
interface RoundObservation {
    policy: 'a' | 'b';
    round: number;
    case: string;
    instrumentation: 'present' | 'absent';
    startScrollTop: number;
    contentHeightBefore: number;
    contentHeightAfter: number;
    contentHeightDelta: number;
    anchorIndex: number | null;
    anchorTopBefore: number | null;
    anchorTopAfter: number | null;
    anchorRendered: boolean;
    residual: number | null;
    requestCount: number | null;
    writeCount: number | null;
    appReportedHold: unknown;
    /**
     * 守卫是否成立，也就是「这一轮真的把要测的场景构造出来了」：
     * 起点在中段、切换确实改变了行高、锚点行切换后仍被渲染。
     *
     * 它**不代表产品对错**——grow 场景要求它为 true，shrink 场景要求它为 false
     * （锚点被回收时守卫本就该失效，那才是要证明的 fail closed）。
     */
    guardHolds: boolean;
}

/**
 * 采样当前滚动状态（全部按布局像素，跨 CSS 缩放可用）。
 *
 * @param page 播放页。
 * @returns 采样结果。
 */
async function sampleScroll(page: Page): Promise<ScrollSample> {
    return page.evaluate(({ scrollerTestId, cardTestId }) => {
        const scroller = document.querySelector<HTMLElement>(`[data-testid="${scrollerTestId}"]`);
        if (!scroller) {
            throw new Error('侧栏滚动容器不存在');
        }
        const scrollerRect = scroller.getBoundingClientRect();
        // 容器可能被 CSS transform 缩放：视觉像素 / 布局像素的比例每次实测
        const scale = scroller.clientHeight > 0 ? scrollerRect.height / scroller.clientHeight : 1;
        const cards = Array.from(
            scroller.querySelectorAll<HTMLElement>(`[data-testid="${cardTestId}"][data-index]`),
        );
        let anchor: { index: number; top: number } | null = null;
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            const top = (rect.top - scrollerRect.top) / scale;
            const bottom = (rect.bottom - scrollerRect.top) / scale;
            if (bottom <= 0) {
                continue;
            }
            anchor = { index: Number(card.dataset.index), top };
            break;
        }
        return {
            scrollTop: scroller.scrollTop,
            contentHeight: scroller.scrollHeight,
            anchor,
            renderedCards: cards.length,
            clientHeight: scroller.clientHeight,
        };
    }, { scrollerTestId: SCROLLER_TESTID, cardTestId: SENTENCE_CARD_TESTID });
}

/**
 * 按 data index 测量某一字幕行当前到容器顶的距离（布局像素）。
 *
 * 用下标而不是「最上面那一行」：重排之后最上面的一行往往已经换人了。
 *
 * @param page 播放页。
 * @param index 行的 data index。
 * @returns 布局像素距离；该行未被渲染时为 null。
 */
async function measureCardTop(page: Page, index: number): Promise<number | null> {
    return page.evaluate(({ cardIndex, scrollerTestId, cardTestId }) => {
        const scroller = document.querySelector<HTMLElement>(`[data-testid="${scrollerTestId}"]`);
        const card = document.querySelector<HTMLElement>(
            `[data-testid="${cardTestId}"][data-index="${cardIndex}"]`,
        );
        if (!scroller || !card) {
            return null;
        }
        const scrollerRect = scroller.getBoundingClientRect();
        const scale = scroller.clientHeight > 0 ? scrollerRect.height / scroller.clientHeight : 1;
        return (card.getBoundingClientRect().top - scrollerRect.top) / scale;
    }, { cardIndex: index, scrollerTestId: SCROLLER_TESTID, cardTestId: SENTENCE_CARD_TESTID });
}

/**
 * 读出当前 scrollTop（布局像素）。
 *
 * @param page 播放页。
 * @returns scrollTop。
 */
async function readScrollTop(page: Page): Promise<number> {
    return page.evaluate((scrollerTestId) => {
        const scroller = document.querySelector<HTMLElement>(`[data-testid="${scrollerTestId}"]`);
        return scroller?.scrollTop ?? 0;
    }, SCROLLER_TESTID);
}

/**
 * 用**真实滚轮输入**把侧栏滚到指定位置。
 *
 * 为什么不能用 `scroller.scrollTop = target`：直接写 DOM 绕过了应用的输入链路，
 * 而 `Subtitle.tsx` 的 `wheel` 监听正是把自动跟随切到 `USER_BROWSING` 的唯一入口。
 * 不经过它，首屏自动跟随仍处于生效状态，会在几百毫秒内把位置拉回顶部
 * （探针实测：写入 900 后读到 900 → 409 → 396 → 63 → 4，最终恒为 4）。
 * 那样「切换前快照」与「用例采样」量的根本不是同一个起点——这是**用例前提不成立**，
 * 而不是补偿逻辑失效。用滚轮滚到目标位置后，应用进入浏览态，位置稳定不动
 * （实测连续 8 次采样全部 900）。
 *
 * @param page 播放页。
 * @param target 目标 scrollTop（布局像素）。
 * @returns 到达后的实际 scrollTop。
 */
async function wheelToScrollTop(page: Page, target: number): Promise<number> {
    const box = await page.getByTestId(SCROLLER_TESTID).boundingBox();
    if (!box) {
        throw new Error('侧栏滚动容器不可见，无法构造滚动起点');
    }
    // 指针移到滚动容器左侧边衬区（避开中间词元，防止触发单词释义浮层捕获滚轮事件）
    await page.mouse.move(box.x + 8, box.y + box.height / 2);

    // 先回到顶部再单向滚下来：这样每一轮的起点都从同一个方向逼近，避免「从深处往上滚」
    // 与「从顶部往下滚」在虚拟列表里落到不同的行高估算上，产生双峰。
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(120);

    let current = await readScrollTop(page);
    for (let attempt = 0; attempt < 80 && Math.abs(current - target) > 2; attempt += 1) {
        const delta = target - current;
        // 单次滚动量夹在 300px 内：一次甩太远会让虚拟列表跳过大段未测量行，
        // 落点由估算行高决定，反而更不准。
        const wheelAmount = Math.sign(delta) * Math.min(Math.abs(delta), 300);
        await page.mouse.wheel(0, wheelAmount);
        await page.waitForTimeout(35);
        current = await readScrollTop(page);
    }
    return current;
}

/**
 * 判断调试埋点是否可用。
 *
 * @param page 播放页。
 * @returns 存在 `__dpDebug` 时为 true。
 */
async function hasInstrumentation(page: Page): Promise<boolean> {
    return page.evaluate(() => Boolean((window as { __dpDebug?: unknown }).__dpDebug));
}

/**
 * 读取「侧栏译文」开关状态。
 *
 * 只认 `aria-pressed`：class 会随皮肤变化，语义不会。
 *
 * @param page 播放页。
 * @returns 开关是否处于开启态。
 */
async function readSideTranslation(page: Page): Promise<boolean> {
    const pressed = await page.getByTestId(SIDE_TRANSLATION_TESTID).getAttribute('aria-pressed');
    return pressed === 'true';
}

/**
 * 点击「侧栏译文」开关，但**不移动鼠标**。
 *
 * 为什么不用 `locator.click()`：Playwright 的 click 会先把真实指针移到元素中心再按下。
 * 开关位于列表**上方**的标题栏里，指针一旦停在那儿，后续 `page.mouse.wheel()` 就滚到了
 * 标题栏（不滚动），而不是字幕列表——实测表现为「滚轮完全没反应、起点恒为 4」。
 *
 * 应用监听的是 DOM `click` 事件，`element.click()` 派发的就是它，语义等价且不碰指针。
 *
 * @param page 播放页。
 * @returns 点击派发后结束。
 */
async function clickSideTranslationWithoutPointer(page: Page): Promise<void> {
    await page.evaluate((toggleTestId) => {
        const toggle = document.querySelector<HTMLElement>(`[data-testid="${toggleTestId}"]`);
        if (!toggle) {
            throw new Error('侧栏译文开关不存在');
        }
        toggle.click();
    }, SIDE_TRANSLATION_TESTID);
}

/**
 * 把「侧栏译文」开关设到指定状态（已经在目标状态时不点）。
 *
 * @param page 播放页。
 * @param on 目标状态。
 * @returns 切换完成后结束（含等待 hold 落地）。
 */
async function setSideTranslation(page: Page, on: boolean): Promise<void> {
    if (await readSideTranslation(page) === on) {
        return;
    }
    const seqBefore = await page.evaluate(
        () => (window as { __dpDebug?: { lastHold: () => { seq: number } | null } }).__dpDebug?.lastHold()?.seq ?? 0,
    );
    await clickSideTranslationWithoutPointer(page);
    await waitForHold(page, seqBefore, 8000).catch(() => undefined);
    // 让 Virtuoso 把重测后的行高落定，避免把上一轮的余波算进本轮
    await page.waitForTimeout(300);
}

/**
 * 等待一次 hold 结束。
 *
 * @param page 播放页。
 * @param seqBefore 点击前的 hold 序号。
 * @param timeout 超时时间（毫秒）。
 * @returns hold 记录。
 */
async function waitForHold(page: Page, seqBefore: number, timeout: number): Promise<unknown> {
    await page.waitForFunction(
        (minSeq) => {
            const debug = (window as {
                __dpDebug?: { lastHold: () => { seq: number; done: boolean } | null };
            }).__dpDebug;
            const hold = debug?.lastHold();
            return Boolean(hold && hold.seq > minSeq && hold.done);
        },
        seqBefore,
        { timeout },
    );
    return page.evaluate(
        () => (window as { __dpDebug?: { lastHold: () => unknown } }).__dpDebug?.lastHold() ?? null,
    );
}

/**
 * 读取从某个时间点之后产生的滚动写入。
 *
 * 用时间戳划界而不是下标：环形缓冲会从头裁掉旧条目，下标会漂。
 *
 * @param page 播放页。
 * @param fromTimestamp 起始时间戳（performance.now()）。
 * @returns 请求类与直接写类的条数。
 */
async function countScrollWrites(
    page: Page,
    fromTimestamp: number,
): Promise<{ requests: number; writes: number; entries: unknown[] }> {
    return page.evaluate((from) => {
        const debug = (window as {
            __dpDebug?: { scrollWrites: Array<{ t: number; kind: 'request' | 'write' }> };
        }).__dpDebug;
        if (!debug) {
            return { requests: 0, writes: 0, entries: [] };
        }
        const recent = debug.scrollWrites.filter((entry) => entry.t >= from);
        return {
            requests: recent.filter((entry) => entry.kind === 'request').length,
            writes: recent.filter((entry) => entry.kind === 'write').length,
            entries: recent,
        };
    }, fromTimestamp);
}

/**
 * 打开播放页（dev/qa 入口：`?file=` 直接入库并进播放页）。
 *
 * @param page 播放页。
 * @returns 打开并等到字幕行渲染出来后结束。
 */
async function openPlayer(page: Page): Promise<void> {
    // 策略开关只存在于 renderer 内存里（hold 在点击时才读它），进页面后再注入就够了
    await page.evaluate((policy) => {
        (window as { __dpPolicy?: string }).__dpPolicy = policy;
    }, POLICY);
    const hash = `#/player/qa?file=${encodeURIComponent(FIXTURE_VIDEO)}&seek=0&lang=zh`;
    await page.evaluate((target) => {
        window.location.hash = target;
    }, hash);
    await page.waitForFunction(
        ({ cardTestId, scrollerTestId }) =>
            document.querySelectorAll(`[data-testid="${cardTestId}"]`).length > 0
            && Boolean(document.querySelector(`[data-testid="${scrollerTestId}"]`)),
        { cardTestId: SENTENCE_CARD_TESTID, scrollerTestId: SCROLLER_TESTID },
        { timeout: 30_000 },
    );
    // 等调试面挂上（main 进程的 devMode 查询是一次异步 IPC）。
    // 这里不吞异常：埋点是这套差分用例的判定依据，等不到就该在开跑前失败，
    // 而不是让后面的断言静默降级成「只验了页面能滚」。
    await page.waitForFunction(
        () => Boolean((window as { __dpDebug?: unknown }).__dpDebug),
        undefined,
        { timeout: 5000 },
    );
    // 等播放器真正就绪，并且**等首屏自动滚动彻底停下**再动滚动。
    //
    // 为什么不能只等固定时长：进入播放页后应用自己会做一轮首屏定位
    // （远距离跳转按 start 对齐，触底还会走「钉下边界 → 停歇 250ms → 平滑归顶」两阶段编排），
    // 实测在约 8 秒后还会再动一次（探针采样：… 4, 4, 409, 4 …）。
    // 在这期间做任何滚动都会和它抢同一个容器。
    //
    // 注意这一步**不能替代**下面用真实滚轮构造起点：即使静稳之后，直接写 `scrollTop`
    // 仍会被自动跟随拉回顶部（因为应用没进入 `USER_BROWSING`）。两步各管一件事：
    // 这里等应用停手，`wheelToScrollTop` 负责让应用交出自己的控制权。
    //
    // 判据用连续 6 次采样相同（约 0.9s 静默）：应用停下来之后不会再有写入方动这个容器。
    // 阈值取 6 而不是 2，是因为平滑滚动的尾段速度很低，相邻两次采样可能恰好相同，
    // 用 2 会提前放行，等于把「还在滑」误判成「已停」。
    await waitForScrollIdle(page);
}

/**
 * 等到侧栏滚动位置连续多次采样不变。
 *
 * @param page 播放页。
 * @param stableSamples 需要连续相同的采样次数。
 * @param intervalMs 采样间隔（毫秒）。
 */
async function waitForScrollIdle(
    page: Page,
    stableSamples = 6,
    intervalMs = 150,
): Promise<void> {
    let previous = Number.NaN;
    let stable = 0;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        const current = await readScrollTop(page);
        if (current === previous) {
            stable += 1;
            if (stable >= stableSamples) {
                return;
            }
        } else {
            stable = 0;
            previous = current;
        }
        await page.waitForTimeout(intervalMs);
    }
    throw new Error('侧栏滚动在超时内没有静稳，无法确定切换前起点');
}

/**
 * 执行一轮观测：钉死起点 → 采样 → 切换译文 → 等 hold → 再采样。
 *
 * @param page 播放页。
 * @param params 本轮参数。
 * @returns 本轮观测结果。
 */
async function runRound(
    page: Page,
    params: {
        round: number;
        case: string;
        startScrollTop: number;
        /** 切换前的译文开关状态。 */
        startTranslation: boolean;
        /**
         * 不为 null 时：把滚动位置甩到这个深度，并在**同一拍**里切换开关。
         * 用来构造「锚点行在测量时已经不在渲染范围内」的场景。
         */
        flingWheelDelta: number | null;
    },
): Promise<RoundObservation> {
    await setSideTranslation(page, params.startTranslation);

    const instrumentation = (await hasInstrumentation(page)) ? 'present' : 'absent';

    // 起点构造：规格的一部分。必须走真实滚轮输入，直接写 scrollTop 会被首屏自动跟随拉回顶部。
    const achievedStart = await wheelToScrollTop(page, params.startScrollTop);
    if (Math.abs(achievedStart - params.startScrollTop) > 2) {
        throw new Error(
            `未能把侧栏滚到起点 ${params.startScrollTop}（实际 ${achievedStart}）：`
            + '滚轮输入没有生效，或列表内容不足以滚到该深度。这是用例前提不成立，不是产品回归。',
        );
    }

    const before = await sampleScroll(page);
    const writesMark = await page.evaluate(() => performance.now());
    const seqBefore = await page.evaluate(
        () => (window as { __dpDebug?: { lastHold: () => { seq: number } | null } }).__dpDebug?.lastHold()?.seq ?? 0,
    );

    if (params.flingWheelDelta === null) {
        await clickSideTranslationWithoutPointer(page);
    } else {
        // 「先切换、立刻甩走」：切换的点击在应用侧同步捕获锚点（store 订阅，早于重渲染），
        // 紧接着用真实滚轮把列表甩到深处，等它去重测时锚点行已被虚拟列表回收。
        //
        // 甩动同样必须走滚轮而不是写 scrollTop：写 scrollTop 会让容器进入
        // 「应用以为位置是自己设的」状态，实测随后被首屏跟随拉回顶部，
        // 锚点行反而一直留在渲染范围里——那样这一轮测的就不是 fail closed 了。
        await clickSideTranslationWithoutPointer(page);
        const box = await page.getByTestId(SCROLLER_TESTID).boundingBox();
        if (!box) {
            throw new Error('侧栏滚动容器不可见，无法构造甩动');
        }
        await page.mouse.move(box.x + 8, box.y + box.height / 2);
        // 滚轮位移与 scrollTop 近似 1:1（实测 900 + 3000 → 3900）。
        // 这里直接给一个远超内容高度的位移，等价于「甩到底部」——锚点在第 1 行时
        // 必然被虚拟列表回收，且结论不依赖行高与总句数（见协议常量里的说明）。
        await page.mouse.wheel(0, params.flingWheelDelta);
    }

    let appReportedHold: unknown = null;
    if (instrumentation === 'present') {
        appReportedHold = await waitForHold(page, seqBefore, 10_000).catch(() => null);
    } else {
        // 没有埋点就退化成定时等待：布局变化 + 收敛窗口给足时间
        await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(150);

    const after = await sampleScroll(page);
    const counts = instrumentation === 'present'
        ? await countScrollWrites(page, writesMark)
        : { requests: null, writes: null, entries: [] };

    // 锚点行是否还在渲染范围内、此刻在什么位置，都只按 data index 认
    const anchorTopAfter = before.anchor === null
        ? null
        : await measureCardTop(page, before.anchor.index);
    const anchorRendered = anchorTopAfter !== null;
    const residual = before.anchor !== null && anchorTopAfter !== null
        ? Math.abs(anchorTopAfter - before.anchor.top)
        : null;
    const contentHeightDelta = after.contentHeight - before.contentHeight;

    // 守卫：起点在中段、切换确实改变了行高、锚点行切换后仍被渲染
    const guardHolds = before.scrollTop > MIN_START_SCROLL_TOP
        && Math.abs(contentHeightDelta) > MIN_CONTENT_HEIGHT_DELTA
        && anchorRendered;

    return {
        policy: POLICY,
        round: params.round,
        case: params.case,
        instrumentation,
        startScrollTop: before.scrollTop,
        contentHeightBefore: before.contentHeight,
        contentHeightAfter: after.contentHeight,
        contentHeightDelta,
        anchorIndex: before.anchor?.index ?? null,
        anchorTopBefore: before.anchor?.top ?? null,
        anchorTopAfter,
        anchorRendered,
        residual,
        requestCount: counts.requests,
        writeCount: counts.writes,
        appReportedHold,
        guardHolds,
    };
}

test.describe('侧栏译文切换后的阅读位置保持', () => {
    test('切换译文后，正在读的那一行留在原处', async ({ session }) => {
        test.setTimeout(PLAYER_TEST_TIMEOUT_MS);
        const { page } = session;
        await openPlayer(page);

        for (let round = 1; round <= ROUNDS; round += 1) {
            // 起始态：译文关闭（单行），切换后行变高 —— 锚点行仍在渲染范围内，hold 有办法补偿
            const observation = await runRound(page, {
                round,
                case: 'grow',
                startScrollTop: START_SCROLL_TOP,
                startTranslation: false,
                flingWheelDelta: null,
            });
            console.log(`${OBSERVATION_PREFIX}${JSON.stringify(observation)}`);

            // 守卫：先证明这一轮确实测到了「中段 + 行高变化 + 锚点仍渲染」
            expect(observation.startScrollTop, '起点必须落在列表中部').toBeGreaterThan(MIN_START_SCROLL_TOP);
            expect(Math.abs(observation.contentHeightDelta), '切换必须真的改变内容高度').toBeGreaterThan(MIN_CONTENT_HEIGHT_DELTA);
            expect(observation.anchorRendered, '锚点行在切换后仍应被渲染').toBe(true);

            // 埋点缺失不是「跳过」而是「无法判定」：静默 continue 会让这套用例在
            // 埋点失效时仍然全绿，只剩「页面能滚到中部」这种弱断言。判红。
            expect(observation.instrumentation, '调试埋点缺失，滚动写入无法判定').toBe('present');

            if (POLICY === 'a') {
                expect(observation.residual, '末轮残差应小于 1 布局像素').not.toBeNull();
                expect(Math.abs(observation.residual ?? Infinity)).toBeLessThan(1);
                // 请求数与写入数是两个子系统：requestCount 记 Virtuoso 的 scrollToIndex/scrollBy，
                // writeCount 记 hold 自己直接改 scrollTop。收敛轮数有上限，两者都要钉住。
                expect(observation.requestCount ?? Infinity, 'Virtuoso 请求类写入不应超过 3 次').toBeLessThanOrEqual(3);
                expect(observation.writeCount ?? Infinity, 'hold 自己的补偿写入不应超过 3 次').toBeLessThanOrEqual(3);
            } else {
                // 对照策略：一次补偿都不许发生
                expect(observation.requestCount, '对照策略不允许出现请求类滚动').toBe(0);
                expect(observation.writeCount, '对照策略不允许直接写 scrollTop').toBe(0);
                // 只断言「没写」不足以证明差分：还得证明这一轮确实产生了偏移，
                // 否则「关掉补偿也没变化」可能只是这轮本来就没漂移，A/B 不成立。
                expect(
                    Math.abs(observation.residual ?? 0),
                    '对照策略下残差应当明显大于 0，否则这一轮不构成对照',
                ).toBeGreaterThan(MIN_CONTENT_HEIGHT_DELTA);
            }
        }
    });

    test('锚点行被虚拟列表回收时一次都不滚（守卫不成立）', async ({ session }) => {
        test.setTimeout(PLAYER_TEST_TIMEOUT_MS);
        const { page } = session;
        await openPlayer(page);

        for (let round = 1; round <= ROUNDS; round += 1) {
            // 起始态：译文开启（双行）；切换后立刻把列表甩到深处，让刚捕获的锚点行被虚拟列表回收
            const observation = await runRound(page, {
                round,
                case: 'shrink-anchor-unmounted',
                startScrollTop: START_SCROLL_TOP,
                startTranslation: true,
                flingWheelDelta: FLING_TO_END_WHEEL_DELTA,
            });
            console.log(`${OBSERVATION_PREFIX}${JSON.stringify(observation)}`);

            // 这一条测的是「锚点被虚拟列表回收时一次都不许滚」，前提是锚点真的被回收了。
            // 前提不成立（比如将来调大 overscan 让锚点留在渲染范围内）时，
            // 应当报成 skip 而不是红：否则产品一改好，这条用例反而失败。
            test.skip(
                observation.anchorRendered,
                '本轮锚点未被回收，场景未构造成功（不是回归）',
            );
            expect(observation.anchorRendered, '锚点行应已不在渲染范围内').toBe(false);
            // 锚点缺失时守卫必然不成立，这是规格里的已知失败场景
            expect(observation.guardHolds, '锚点行被回收时守卫不成立').toBe(false);

            expect(observation.instrumentation, '调试埋点缺失，滚动写入无法判定').toBe('present');
            // fail closed：锚不住就一次都不许滚（不论策略，请求与直接写都必须为 0）
            expect(observation.requestCount, '锚点缺失时不允许请求滚动').toBe(0);
            expect(observation.writeCount, '锚点缺失时不允许直接写 scrollTop').toBe(0);
            expect(observation.appReportedHold, '应用应把这一轮记成 anchor-missing').toMatchObject({
                outcome: 'anchor-missing',
            });
        }
    });
});
