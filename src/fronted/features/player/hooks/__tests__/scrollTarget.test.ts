import { describe, it, expect } from 'vitest';
import { computeScrollTarget } from '../scrollTarget';

/**
 * 构造一份快照。
 *
 * @param scrollTop 滚动位置（布局像素）。
 * @param anchor 锚点快照；null 表示该次采样里锚点行没被渲染。
 */
const snapshot = (scrollTop: number, anchor: { index: number; top: number } | null) => ({
    scrollTop,
    anchor,
});

describe('布局变化后的滚动目标换算', () => {
    it('行在布局里下移多少，滚动位置就跟进多少，让锚点停在原处', () => {
        // 译文打开后每行变高：锚点行从距容器顶 100px 变成 260px
        const target = computeScrollTarget({
            before: snapshot(900, { index: 12, top: 100 }),
            after: snapshot(900, { index: 12, top: 260 }),
        });
        expect(target).toEqual({ scrollTop: 1060 });
    });

    it('重测期间容器自己漂过一段时，以当前 scrollTop 为基准，不重复补偿那段漂移', () => {
        // 真实时序：切换瞬间 scrollTop=900，Virtuoso 重测行高时把容器推到 1178，
        // 此刻锚点相对当前视口只偏了 13.66px。若仍以 900 为基准，就会算出 913.66，
        // 而正确落点是 1178 + 13.66 —— 前者会让下一轮再次测到同一偏移，循环发散。
        const target = computeScrollTarget({
            before: snapshot(900, { index: 12, top: -366.9 }),
            after: snapshot(1178, { index: 12, top: -353.2 }),
        });
        expect(target).not.toBeNull();
        expect(target?.scrollTop).toBeCloseTo(1191.7, 1);
    });

    it('行在布局里上移时反向回滚，位置不会被推到负数以下', () => {
        // 译文关闭后行变矮：锚点行从 100px 变成 -40px
        expect(computeScrollTarget({
            before: snapshot(900, { index: 12, top: 100 }),
            after: snapshot(900, { index: 12, top: -40 }),
        })).toEqual({ scrollTop: 760 });

        // 本来就在顶部附近时，回滚量被 0 挡住
        expect(computeScrollTarget({
            before: snapshot(30, { index: 1, top: 10 }),
            after: snapshot(30, { index: 1, top: -50 }),
        })).toEqual({ scrollTop: 0 });
    });

    it('变化后的锚点行没被渲染时拒绝滚动', () => {
        expect(computeScrollTarget({
            before: snapshot(900, { index: 12, top: 100 }),
            after: snapshot(900, null),
        })).toBeNull();
    });

    it('变化前的锚点行就缺失时同样拒绝滚动', () => {
        expect(computeScrollTarget({
            before: snapshot(900, null),
            after: snapshot(900, { index: 12, top: 260 }),
        })).toBeNull();
    });

    it('两次锚点不是同一行时拒绝滚动', () => {
        expect(computeScrollTarget({
            before: snapshot(900, { index: 12, top: 100 }),
            after: snapshot(900, { index: 13, top: 260 }),
        })).toBeNull();
    });

    it('单步位移被 maxStepPx 双向夹住', () => {
        expect(computeScrollTarget({
            before: snapshot(900, { index: 12, top: 100 }),
            after: snapshot(900, { index: 12, top: 900 }),
        }, { maxStepPx: 240 })).toEqual({ scrollTop: 1140 });

        expect(computeScrollTarget({
            before: snapshot(900, { index: 12, top: 100 }),
            after: snapshot(900, { index: 12, top: -900 }),
        }, { maxStepPx: 240 })).toEqual({ scrollTop: 660 });
    });

    it('反例护栏：位移方向写反、或者干脆不动，都必须在这条断言上变红', () => {
        // 断言直接从需求出发，不套用被测公式：
        // 「写入目标后，锚点行在容器里的位置必须和变化前一模一样」。
        // 因此 expectedShift = 行在布局里移动的距离（after - before），
        // 把方向写反（before - after）会得到相反数、把目标写成原位置会得到 0，两种错法都过不了。
        const cases = [
            { name: '译文打开、行变高', scrollTop: 900, beforeTop: 12, afterTop: 172 },
            { name: '译文关闭、行变矮', scrollTop: 900, beforeTop: -48, afterTop: -228 },
            { name: '行几乎没动', scrollTop: 40, beforeTop: 6, afterTop: -2 },
        ];

        for (const item of cases) {
            const target = computeScrollTarget({
                before: snapshot(item.scrollTop, { index: 7, top: item.beforeTop }),
                after: snapshot(item.scrollTop, { index: 7, top: item.afterTop }),
            });
            expect(target, item.name).not.toBeNull();
            const targetScrollTop = target?.scrollTop ?? Number.NaN;

            // 1) 位移量等于行移动的距离
            expect(targetScrollTop - item.scrollTop, item.name).toBeCloseTo(item.afterTop - item.beforeTop, 6);
            // 2) 写入后锚点回到原来的视觉位置（用真实内容坐标重算一遍，而不是相信 1) 的代数）
            const anchorTopAfterWrite = (item.scrollTop + item.afterTop) - targetScrollTop;
            expect(anchorTopAfterWrite, item.name).toBeCloseTo(item.beforeTop, 6);
            // 3) 两种典型错法各自的取值，明确钉住「不许是它们」
            const flippedSign = item.scrollTop + (item.beforeTop - item.afterTop);
            expect(targetScrollTop, `${item.name}：方向写反的取值`).not.toBe(flippedSign);
            expect(targetScrollTop, `${item.name}：原样不动的取值`).not.toBe(item.scrollTop);
        }
    });

    it('锚点相对视口没动时，目标就是当前滚动位置，不把容器自己漂移的那段再补偿一次', () => {
        // 切换后 Virtuoso 已经把容器推到 920，锚点相对视口恰好还在 100px。
        // 此时正确的动作是「什么都不用补」——若返回 900，就会把用户从 920 拽回 900，
        // 下一轮再测又偏 20px，形成来回摆。
        expect(computeScrollTarget({
            before: snapshot(900, { index: 12, top: 100 }),
            after: snapshot(920, { index: 12, top: 100 }),
        })).toEqual({ scrollTop: 920 });
    });
});
