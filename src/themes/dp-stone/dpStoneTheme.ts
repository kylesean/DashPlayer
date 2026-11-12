/**
 * Refrain Stone 主题：在 Astryx 官方 stone 之上补齐中文回退与浅色层级。
 *
 * 官方 stone 的浅色卡片/浮层是纯白，与主题的暖石底色缺少过渡；
 * 这里把浅色面调成带一点冷调的纸白，深色值沿用官方主题。
 * 标题保留 Montserrat（拉丁），中文回退到无衬线字族，避免中英混排跳字形。
 */
import { defineTheme } from '@astryxdesign/core/theme';
import { stoneTheme } from '@astryxdesign/theme-stone/built';

/** 中文回退：优先各平台自带的高质量无衬线中文字体。 */
const CJK_FALLBACK =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

export const dpStoneTheme = defineTheme({
    name: 'dp-stone',
    extends: stoneTheme,
    tokens: {
        '--font-family-body': `Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--font-family-heading': `Montserrat, "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--color-background-card': ['#f5f6fa', '#25252a'],
        '--color-background-surface': ['#fafbfd', '#1b1b21'],
        '--color-background-popover': ['#fafbfd', '#302f36'],
    },
});
