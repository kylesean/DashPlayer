import { describe, expect, it } from 'vitest';
import { SCROLL_TIMERS, scrollTimerDelay } from '../subtitle-scroll-timers';

describe('字幕滚动计时表', () => {
    it('每条计时都声明了目标状态与存在理由', () => {
        for (const [name, spec] of Object.entries(SCROLL_TIMERS)) {
            expect(spec.delay, `${name} 缺少延时`).toBeGreaterThan(0);
            expect(spec.purpose.length, `${name} 缺少理由`).toBeGreaterThan(0);
        }
    });

    it('延时量级保持在「人能感知但不拖沓」的区间', () => {
        // 上限 1s：滚动沉降超过 1s 用户会觉得卡住；
        // 下限 50ms：低于一帧的沉降等于没沉降，会把滚动事件当成新输入。
        for (const [name, spec] of Object.entries(SCROLL_TIMERS)) {
            expect(spec.delay, `${name} 过长`).toBeLessThanOrEqual(1000);
            expect(spec.delay, `${name} 过短`).toBeGreaterThanOrEqual(50);
        }
    });

    it('滚动沉降类计时都回到 NORMAL，只有测量冻结是还原语义', () => {
        expect(SCROLL_TIMERS.RESUME_NORMAL.target).toBe('NORMAL');
        expect(SCROLL_TIMERS.AUTO_SETTLE.target).toBe('NORMAL');
        expect(SCROLL_TIMERS.TOP_SETTLE.target).toBe('NORMAL');
        expect(SCROLL_TIMERS.PIN_DEBOUNCE.target).toBe('AUTO_SCROLLING');
        // 冻结不是进入某个固定状态，而是暂停后放回，所以是 RESTORE
        expect(SCROLL_TIMERS.PAUSE_MEASUREMENT.target).toBe('RESTORE');
    });

    it('按名取延时与直接读表一致', () => {
        expect(scrollTimerDelay('RESUME_NORMAL')).toBe(SCROLL_TIMERS.RESUME_NORMAL.delay);
        expect(scrollTimerDelay('PAUSE_MEASUREMENT')).toBe(SCROLL_TIMERS.PAUSE_MEASUREMENT.delay);
    });

    it('归顶沉降必须长于切句防抖，否则归顶动画会被提前打断', () => {
        // 第二阶段「平滑归顶」的动画时长应与沉降时长同量级且更长，
        // 否则状态会在动画结束前回到 NORMAL，下一次切句会打断上一次动画。
        expect(SCROLL_TIMERS.TOP_SETTLE.delay).toBeGreaterThan(SCROLL_TIMERS.PIN_DEBOUNCE.delay);
    });
});
