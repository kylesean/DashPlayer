import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatMemoryWhen } from '../word-memory-time';

/** 回显参数，方便断言传给翻译函数的变量。 */
const t = (key: string, options?: Record<string, unknown>): string => (
    options && Object.keys(options).length > 0 ? `${key}:${JSON.stringify(options)}` : key
);

describe('formatMemoryWhen', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const at = (iso: string): void => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(iso));
    };

    it('从未发生时不编造时间', () => {
        at('2026-11-12T12:00:00.000Z');
        expect(formatMemoryWhen(null, 'zh-CN', t, 'wordMemory.neverSeen'))
            .toBe('wordMemory.neverSeen');
        expect(formatMemoryWhen('not-a-date', 'zh-CN', t, 'wordMemory.neverSeen'))
            .toBe('wordMemory.neverSeen');
    });

    it('一分钟内显示刚刚，未来时间也不显示负数', () => {
        at('2026-11-12T12:00:00.000Z');
        expect(formatMemoryWhen('2026-11-12T11:59:40.000Z', 'zh-CN', t, 'x'))
            .toBe('wordMemory.justNow');
        expect(formatMemoryWhen('2026-11-12T12:05:00.000Z', 'zh-CN', t, 'x'))
            .toBe('wordMemory.justNow');
    });

    it('按分钟、小时、天分档', () => {
        at('2026-11-12T12:00:00.000Z');
        expect(formatMemoryWhen('2026-11-12T11:30:00.000Z', 'zh-CN', t, 'x'))
            .toBe('wordMemory.minutesAgo:{"count":30}');
        expect(formatMemoryWhen('2026-11-12T06:00:00.000Z', 'zh-CN', t, 'x'))
            .toBe('wordMemory.hoursAgo:{"count":6}');
        expect(formatMemoryWhen('2026-11-09T12:00:00.000Z', 'zh-CN', t, 'x'))
            .toBe('wordMemory.daysAgo:{"count":3}');
    });

    it('超过 30 天退回日期，避免出现没人换算的天数', () => {
        at('2026-11-12T12:00:00.000Z');
        const text = formatMemoryWhen('2026-09-01T12:00:00.000Z', 'en-US', t, 'x');
        expect(text).not.toContain('daysAgo');
        expect(text).toMatch(/Sep/);
    });
});
