import { describe, expect, it } from 'vitest';
import { SCROLL_TIMERS, scrollTimerDelay } from '../subtitle-scroll-timers';

const TIMER_ENTRIES = Object.entries(SCROLL_TIMERS);

describe('字幕滚动计时表', () => {
    it.each(TIMER_ENTRIES)('计时项 %s 声明了有效延时区间（50ms~1000ms）与存在理由', (_name, spec) => {
        expect(spec.delay).toBeGreaterThanOrEqual(50);
        expect(spec.delay).toBeLessThanOrEqual(1000);
        expect(spec.purpose.length).toBeGreaterThan(0);
    });

    it('按名取延时与直接读表一致', () => {
        expect(scrollTimerDelay('RESUME_NORMAL')).toBe(SCROLL_TIMERS.RESUME_NORMAL.delay);
        expect(scrollTimerDelay('PAUSE_MEASUREMENT')).toBe(SCROLL_TIMERS.PAUSE_MEASUREMENT.delay);
    });

    it('归顶沉降必须长于切句防抖，否则归顶动画会被提前打断', () => {
        expect(SCROLL_TIMERS.TOP_SETTLE.delay).toBeGreaterThan(SCROLL_TIMERS.PIN_DEBOUNCE.delay);
    });
});
