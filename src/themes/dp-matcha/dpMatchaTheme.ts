/**
 * DashPlayer Matcha 主题：在 Astryx 官方 matcha 之上补齐中文回退与浅色层级。
 *
 * 官方 matcha 的标题用 Playwrite US Trad（拉丁手写体）。它没有中文字形，
 * 中文会沿 Georgia → Times → 系统衬线一路回落，导致同一行里英文手写、
 * 中文衬线。这里保留英文手写体，但把中文回退显式放到无衬线字族，
 * 与正文的中文字形保持一致。
 */
import { defineTheme } from '@astryxdesign/core/theme';
import { matchaTheme } from '@astryxdesign/theme-matcha/built';

/** 中文回退：优先各平台自带的高质量无衬线中文字体。 */
const CJK_FALLBACK =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

export const dpMatchaTheme = defineTheme({
    name: 'dp-matcha',
    extends: matchaTheme,
    tokens: {
        '--font-family-body': `"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--font-family-heading': `"Playwrite US Trad", Georgia, "Times New Roman", ${CJK_FALLBACK}`,
        '--color-background-card': ['#fbfbf2', '#1e2016'],
        '--color-background-surface': ['#f7f7ea', '#1a1c14'],
        '--color-background-popover': ['#fbfbf2', '#3e481d'],
    },
});
