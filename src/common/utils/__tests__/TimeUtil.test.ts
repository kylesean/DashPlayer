import { describe, expect, it } from 'vitest';
import TimeUtil from '@/common/utils/TimeUtil';

describe('时间工具', () => {
    describe('紧凑时长格式化', () => {
        it('空值返回空字符串', () => {
            expect(TimeUtil.secondToTimeStrCompact(null)).toBe('');
            expect(TimeUtil.secondToTimeStrCompact(undefined)).toBe('');
        });

        it('零秒补齐为两位分秒', () => {
            expect(TimeUtil.secondToTimeStrCompact(0)).toBe('00:00');
        });

        it('分钟和秒不足两位时自动补零', () => {
            expect(TimeUtil.secondToTimeStrCompact(5)).toBe('00:05');
            expect(TimeUtil.secondToTimeStrCompact(65)).toBe('01:05');
            expect(TimeUtil.secondToTimeStrCompact(125)).toBe('02:05');
        });

        it('满一小时时输出带小时的补零格式', () => {
            expect(TimeUtil.secondToTimeStrCompact(3600)).toBe('1:00:00');
            expect(TimeUtil.secondToTimeStrCompact(4729)).toBe('1:18:49');
            expect(TimeUtil.secondToTimeStrCompact(3605)).toBe('1:00:05');
        });
    });

    describe('标准时长格式化与毫秒格式化', () => {
        it('空值返回空字符串', () => {
            expect(TimeUtil.secondToTimeStr(null)).toBe('');
            expect(TimeUtil.secondToTimeStrWithMs(undefined)).toBe('');
        });

        it('正确格式化标准时分秒与毫秒', () => {
            expect(TimeUtil.secondToTimeStr(0)).toBe('00:00:00');
            expect(TimeUtil.secondToTimeStr(3661.9)).toBe('01:01:01');
            expect(TimeUtil.secondToTimeStrWithMs(0.29)).toBe('00:00:00.290');
            expect(TimeUtil.secondToTimeStrWithMs(3661.5)).toBe('01:01:01.500');
        });
    });

    describe('数据库 UTC 与 ISO 时间互转', () => {
        it('按 UTC 解析无时区标识的数据库时间字符串与带时区 ISO 字符串', () => {
            expect(TimeUtil.isoToDate('2026-03-15 08:30:05').toISOString()).toBe('2026-03-15T08:30:05.000Z');
            expect(TimeUtil.isoToDate('2026-03-15T08:30:05.123Z').toISOString()).toBe('2026-03-15T08:30:05.123Z');
        });

        it('按 UTC 输出数据库约定的时间字符串，并对无效日期显式抛错', () => {
            const d = new Date('2026-03-15T08:30:05.000Z');
            expect(TimeUtil.dateToUtc(d)).toBe('2026-03-15 08:30:05');
            expect(() => TimeUtil.dateToUtc(new Date('invalid'))).toThrow('无效的日期对象');
        });
    });
});
