import { describe, expect, it } from 'vitest';
import {
    decideHomePlacement,
    decideLockedOutcome,
    isHomeSize,
} from '../home-window-outcome';

const HOME: readonly [number, number] = [1200, 800];

describe('首页窗口模式结局判定', () => {
    it('尺寸与设计值一致时由应用锁死', () => {
        expect(decideHomePlacement([1200, 800], HOME)).toBe('lock');
    });

    it('尺寸被窗口管理器改动时让路', () => {
        // 平铺式窗口管理器会按布局摆窗口，忽略应用的尺寸请求
        expect(decideHomePlacement([1920, 1080], HOME)).toBe('yield-size');
        expect(decideHomePlacement([1200, 801], HOME)).toBe('yield-size');
        expect(decideHomePlacement([1199, 800], HOME)).toBe('yield-size');
    });

    it('任一维度不同都不算设计尺寸', () => {
        expect(isHomeSize([1200, 800], HOME)).toBe(true);
        expect(isHomeSize([1200, 0], HOME)).toBe(false);
        expect(isHomeSize([0, 800], HOME)).toBe(false);
    });

    it('锁死后未被覆盖则保持锁死', () => {
        expect(decideLockedOutcome(false)).toBe('locked');
    });

    it('锁死后迟到的 configure 必须撤销锁死', () => {
        // 否则窗口会被设计尺寸钉住，用户拉不动也最大化不了
        expect(decideLockedOutcome(true)).toBe('yielded-late-resize');
    });

    it('三种实际结局互不相同，日志与断言可以区分', () => {
        const outcomes = new Set([
            decideHomePlacement([1200, 800], HOME) === 'lock' ? 'locked' : 'yielded-size',
            decideLockedOutcome(true),
            'yielded-size',
        ]);
        expect(outcomes.size).toBe(3);
    });
});
