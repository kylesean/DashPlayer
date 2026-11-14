import { describe, expect, it } from 'vitest';
import {
    normalizeMirroredTheme,
    resolveEffectiveThemeMode,
} from '@/frontend/app/lib/startup-theme';

describe('startup-theme 首屏主题模式裁决', () => {
    it.each([
        { raw: 'dark', expected: 'dark' },
        { raw: 'light', expected: 'light' },
        { raw: 'system', expected: null },
        { raw: undefined, expected: null },
        { raw: null, expected: null },
    ])('normalizeMirroredTheme($raw) -> $expected', ({ raw, expected }) => {
        expect(normalizeMirroredTheme(raw)).toBe(expected);
    });

    it.each([
        {
            name: '设置未水合时沿用 dark 镜像，不提前退回 system/light',
            input: { settingsInit: false, mirroredTheme: 'dark' as const, theme: undefined, isDarkOnlyTheme: false },
            expected: 'dark',
        },
        {
            name: '设置未水合且无镜像时回落 system',
            input: { settingsInit: false, mirroredTheme: null, theme: undefined, isDarkOnlyTheme: false },
            expected: 'system',
        },
        {
            name: '设置水合后深色专用主题强制 dark',
            input: { settingsInit: true, mirroredTheme: 'light' as const, theme: 'light', isDarkOnlyTheme: true },
            expected: 'dark',
        },
        {
            name: '设置水合后真实配置覆盖过期镜像',
            input: { settingsInit: true, mirroredTheme: 'dark' as const, theme: 'light', isDarkOnlyTheme: false },
            expected: 'light',
        },
        {
            name: '设置水合后未指定显式明暗或为 system 时交由 system',
            input: { settingsInit: true, mirroredTheme: 'dark' as const, theme: 'system', isDarkOnlyTheme: false },
            expected: 'system',
        },
    ])('$name', ({ input, expected }) => {
        expect(resolveEffectiveThemeMode(input)).toBe(expected);
    });
});
