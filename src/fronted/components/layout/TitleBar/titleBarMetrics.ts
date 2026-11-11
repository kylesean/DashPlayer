/**
 * 桌面窗口标题栏的固定像素高度。
 *
 * 窗口 chrome 属于系统级尺寸，不能交给 Tailwind 的 spacing 工具类表达：
 * Astryx 的 Tailwind bridge 把 `--spacing` 指向当前主题的 `--spacing-1`，
 * Matcha / Y2K 的 `--spacing-1` 是 6px 而不是 4px。若标题栏继续写 `h-8`，
 * 切到这两套主题后内部会从 32px 膨胀到 48px，再被固定 32px 的 LayoutHeader 裁掉。
 */
export const TITLE_BAR_HEIGHT = 32;
