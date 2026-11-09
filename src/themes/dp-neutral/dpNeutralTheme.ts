/**
 * DashPlayer Neutral 主题：在 Astryx 官方 neutral 之上补齐两件事。
 *
 * 1. 中文回退：官方主题字体只覆盖拉丁字形，中文会落到浏览器默认的
 *    generic family（标题甚至可能变成系统衬线），与拉丁字形混排很违和。
 *    这里保留主题原有拉丁字体，只把中文回退显式写成无衬线字族。
 * 2. 浅色卡片：官方主题在 light 模式下把 card/surface/popover 都定为纯白，
 *    界面大面积是 Card，切换主题时几乎看不出变化。这里给浅色面加一层
 *    很淡的主题色，深色值沿用官方主题，避免改坏暗色层级。
 */
import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

/** 中文回退：优先各平台自带的高质量无衬线中文字体。 */
const CJK_FALLBACK =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

export const dpNeutralTheme = defineTheme({
    name: 'dp-neutral',
    extends: neutralTheme,
    tokens: {
        '--font-family-body': `Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--font-family-heading': `Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--color-background-card': ['#ffffff', '#1b1b1b'],
        '--color-background-surface': ['#ffffff', '#262626'],
        '--color-background-popover': ['#ffffff', '#1b1b1b'],
    },
});
