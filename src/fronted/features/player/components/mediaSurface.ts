import type { CSSProperties } from 'react';

/**
 * 媒体层（视频画面、遮幅、画面上的浮层）配色。
 *
 * 刻意不接 Astryx 主题 token：应用外壳（导航、设置、表单）跟随 light/dark，
 * 但视频底是“银幕”，浅色主题下也必须保持深色——浅色 token 会让遮幅反白、
 * 白字幕的对比度直接崩掉。视频控制条早已按同一原则处理
 * （见 `DARK_BAR_BUTTON_HOVER` 的注释），这里把这条约定显式收成一层。
 *
 * 增删这里的取值时只改本文件，不要在播放组件里散写 hex 或主题色。
 */

/** 视频遮幅底色：近黑但不纯黑，深色主题下与 body 仍能分出边界。 */
export const MEDIA_MATTE_CLASS = 'bg-media-matte';

/** 视频面板的 1px 内描边：深色主题下把银幕与应用底色分开，避免糊成一整块。 */
export const MEDIA_FRAME_CLASS = 'ring-1 ring-inset ring-media-fg/5';

/**
 * Astryx Slider 默认跟随主题的 accent / track 色。
 *
 * 视频控制条属于媒体层，浅色主题下仍是深色银幕，进度与音量必须保持中性白，
 * 不能随主题变成绿/紫/棕。这里只在滑杆宿主上局部覆盖两个 CSS 变量，
 * 不改全局主题，也不会影响设置页里跟随主题的滑杆。
 */
export const MEDIA_SLIDER_STYLE = {
    '--color-accent': 'var(--color-media-fg)',
    '--color-track': 'color-mix(in srgb, var(--color-media-fg) 22%, transparent)',
} as CSSProperties;
