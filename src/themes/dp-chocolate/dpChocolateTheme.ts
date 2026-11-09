/**
 * DashPlayer Chocolate 主题：在 Astryx 官方 chocolate 之上补齐中文回退。
 *
 * 官方 chocolate 的浅色卡片本身就是焦糖纸色（#EDE4D4），层级已经很明显，
 * 因此这里只处理字体：正文保留 Albert Sans，标题保留 Fraunces（衬线），
 * 中文分别回退到无衬线 / 宋体，避免中文掉进浏览器默认字体。
 */
import { defineTheme } from '@astryxdesign/core/theme';
import { chocolateTheme } from '@astryxdesign/theme-chocolate/built';

/** 中文无衬线回退：与正文的 Albert Sans 搭配。 */
const CJK_SANS =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

/** 中文衬线回退：与标题的 Fraunces 搭配，中文标题保留书卷气。 */
const CJK_SERIF =
    '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif';

export const dpChocolateTheme = defineTheme({
    name: 'dp-chocolate',
    extends: chocolateTheme,
    tokens: {
        '--font-family-body': `"Albert Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_SANS}`,
        '--font-family-heading': `Fraunces, Georgia, "Times New Roman", ${CJK_SERIF}`,
    },
});
