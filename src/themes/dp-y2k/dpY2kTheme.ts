/**
 * DashPlayer Y2K 主题：在 Astryx 官方 y2k 之上补齐中文回退与浅色层级。
 *
 * 官方 y2k 的浅色卡片是纯白，落在长春花蓝的页面底色上缺少层次；
 * 这里把卡片/浮层调成带一点蓝紫的纸白，深色值沿用官方主题。
 */
import { defineTheme } from '@astryxdesign/core/theme';
import { y2kTheme } from '@astryxdesign/theme-y2k/built';

/** 中文回退：优先各平台自带的高质量无衬线中文字体。 */
const CJK_FALLBACK =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

export const dpY2kTheme = defineTheme({
    name: 'dp-y2k',
    extends: y2kTheme,
    tokens: {
        '--font-family-body': `Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--font-family-heading': `Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--color-background-card': ['#eff2ff', '#16182b'],
        '--color-background-surface': ['#f7f8ff', '#16182b'],
        '--color-background-popover': ['#f7f8ff', '#1f2238'],
    },
});
