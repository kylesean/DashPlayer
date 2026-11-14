/**
 * 主题家族 ↔ 本地主题的映射与派生信息。
 *
 * 本地主题在官方主题基础上补了中文回退与浅色卡片层级，slug 带 `dp-` 前缀；
 * 后端存储仍沿用 neutral/stone/gothic/matcha/y2k/butter/chocolate，避免改历史数据。
 */
import { resolveThemeTokens } from '@astryxdesign/core/theme';
import type { AppearanceThemeFamily } from '@/common/contracts/appearance-setting-vo';
import { themes, type ThemeSlug } from '../../astryx-themes';

/** 持久化的主题家族值 → 本地主题 slug。 */
export const THEME_SLUG_BY_FAMILY = {
    neutral: 'dp-neutral',
    stone: 'dp-stone',
    gothic: 'dp-gothic',
    matcha: 'dp-matcha',
    y2k: 'dp-y2k',
    butter: 'dp-butter',
    chocolate: 'dp-chocolate',
} as const satisfies Record<AppearanceThemeFamily, ThemeSlug>;

/**
 * 深色专用主题。
 *
 * Gothic 的 token 是绝对值而不是 light-dark 对，切到浅色模式会出现
 * 深色主题配浅色原生控件。选中这些主题时强制走 dark 模式。
 */
export const DARK_ONLY_THEME_SLUGS: ReadonlySet<ThemeSlug> = new Set<ThemeSlug>(['dp-gothic']);

/**
 * 每套主题用哪个 token 作为预览色。
 *
 * 默认取 accent；Y2K 的记忆点是长春花蓝页面而不是深棕 accent，
 * 所以浅色取 background-body、深色仍取 accent（页面色太暗）。
 */
const PREVIEW_TOKEN: Record<AppearanceThemeFamily, { light: string; dark: string }> = {
    neutral: { light: '--color-accent', dark: '--color-accent' },
    stone: { light: '--color-accent', dark: '--color-accent' },
    gothic: { light: '--color-accent', dark: '--color-accent' },
    matcha: { light: '--color-accent', dark: '--color-accent' },
    y2k: { light: '--color-background-body', dark: '--color-accent' },
    butter: { light: '--color-accent', dark: '--color-accent' },
    chocolate: { light: '--color-accent', dark: '--color-accent' },
};

/**
 * 解析某套主题在指定模式下的预览色。
 *
 * @param family 主题家族。
 * @param mode 颜色模式。
 * @returns 具体 CSS 颜色值。
 */
function resolvePreviewColor(family: AppearanceThemeFamily, mode: 'light' | 'dark'): string {
    const theme = themes[THEME_SLUG_BY_FAMILY[family]];
    const token = PREVIEW_TOKEN[family][mode];
    return resolveThemeTokens(theme, { mode })[token];
}

/**
 * 主题卡片的取色点。
 *
 * 直接从主题包解析，而不是在 UI 里硬编码 hex；新增主题时不需要再补一组手写色值。
 */
export const THEME_PREVIEW_COLORS: Record<AppearanceThemeFamily, string> = {
    neutral: `light-dark(${resolvePreviewColor('neutral', 'light')}, ${resolvePreviewColor('neutral', 'dark')})`,
    stone: `light-dark(${resolvePreviewColor('stone', 'light')}, ${resolvePreviewColor('stone', 'dark')})`,
    gothic: `light-dark(${resolvePreviewColor('gothic', 'light')}, ${resolvePreviewColor('gothic', 'dark')})`,
    matcha: `light-dark(${resolvePreviewColor('matcha', 'light')}, ${resolvePreviewColor('matcha', 'dark')})`,
    y2k: `light-dark(${resolvePreviewColor('y2k', 'light')}, ${resolvePreviewColor('y2k', 'dark')})`,
    butter: `light-dark(${resolvePreviewColor('butter', 'light')}, ${resolvePreviewColor('butter', 'dark')})`,
    chocolate: `light-dark(${resolvePreviewColor('chocolate', 'light')}, ${resolvePreviewColor('chocolate', 'dark')})`,
};
