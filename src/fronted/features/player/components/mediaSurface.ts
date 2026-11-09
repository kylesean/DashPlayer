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

/** 视频面板内的暗角：压暗四周，让画面与遮幅过渡自然。 */
export const MEDIA_VIGNETTE_CLASS = 'bg-gradient-to-b from-media-bg/15 via-media-bg/10 to-media-bg/25';

/**
 * 可选环境光画布：只在用户显式开启时渲染。
 *
 * 亮度刻意压得比原设计更低（0.45 / 深色 0.35）：环境光负责氛围，
 * 不能亮到和字幕抢注意力。
 */
export const MEDIA_AMBIENT_CANVAS_CLASS =
    'absolute inset-0 h-full w-full pointer-events-none z-0 blur-[80px] saturate-[1.05] brightness-[0.45] dark:brightness-[0.35]';
