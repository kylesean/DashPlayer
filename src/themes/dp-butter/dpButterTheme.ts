/**
 * Refrain Butter 主题：在 Astryx 官方 butter 之上补齐中文回退与浅色层级。
 *
 * 官方 butter 的浅色卡片是纯白，与奶油色页面底色之间缺少过渡；
 * 这里把卡片/浮层调成带暖调的纸白，深色值沿用官方主题，
 * 避免破坏暗色下的层级关系。
 */
import { defineTheme } from '@astryxdesign/core/theme';
import { butterTheme } from '@astryxdesign/theme-butter/built';

/** 中文回退：优先各平台自带的高质量无衬线中文字体。 */
const CJK_FALLBACK =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

export const dpButterTheme = defineTheme({
    name: 'dp-butter',
    extends: butterTheme,
    tokens: {
        '--font-family-body': `Outfit, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--font-family-heading': `Outfit, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--color-background-card': ['#fff7d3', '#3a2a1f'],
        '--color-background-surface': ['#fff9e0', '#2e2117'],
        '--color-background-popover': ['#fff7d3', '#3a2a1f'],
    },
});
