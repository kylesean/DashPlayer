/**
 * Refrain Gothic 主题：在 Astryx 官方 gothic 之上补齐中文回退。
 *
 * gothic 是深色专用主题：token 是绝对值而不是 light-dark 对，
 * 因此这里的配色全部沿用官方，不做浅色适配；
 * 应用层会强制使用 dark 模式，避免原生控件与主题打架。
 */
import { defineTheme } from '@astryxdesign/core/theme';
import { gothicTheme } from '@astryxdesign/theme-gothic/built';

/** 中文回退：优先各平台自带的高质量无衬线中文字体。 */
const CJK_FALLBACK =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

export const dpGothicTheme = defineTheme({
    name: 'dp-gothic',
    extends: gothicTheme,
    tokens: {
        '--font-family-body': `Fustat, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
        '--font-family-heading': `Fustat, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_FALLBACK}`,
    },
});
