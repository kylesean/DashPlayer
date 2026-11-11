/**
 * 学习工具条的共用外观。
 *
 * 同一条工具条会出现在两种底色上：
 * - `panel`：主字幕面板（跟随应用主题，浅色/深色主题各一套 token）；
 * - `overlay`：视频画面上的深色悬浮控制条（恒定深底白字，不能按主题取反色）。
 *
 * 按钮、分隔线、激活色、徽章、分段控件只在这里分叉，各控件不再各写一套，
 * 否则两个宿主上会慢慢长出两种观感。
 */

/** 工具条宿主底色：字幕面板 / 视频画面深色条。 */
export type ToolbarTone = 'panel' | 'overlay';

/** 激活态语义色：琥珀=循环/时间、翠绿=暂停/跟读/学习、中性=普通开关。 */
export type ToolbarAccent = 'amber' | 'emerald' | 'neutral';

/** 图标按钮基础形状（尺寸与圆角），升级为标准 32px 舒适触达网格。 */
export const TOOLBAR_ICON_BUTTON =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-150 cursor-pointer';

/** 带文字/徽章的按钮基础形状，与同一行的图标按钮同高同圆角。 */
export const TOOLBAR_TEXT_BUTTON =
    'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium leading-none transition-all duration-150 cursor-pointer';

/** 分段控件（EN / 中 / 双语）的外壳。 */
export const TOOLBAR_SEGMENTED =
    'flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5 bg-surface/50';

/** 分隔线：两种底色共用形状，颜色由 tone 决定。 */
export const TOOLBAR_DIVIDER = 'mx-1 h-4 w-px shrink-0';

/** 普通开关按钮上挂徽章时的样式（进度、倍速、倒计时）。 */
export const TOOLBAR_BADGE =
    'rounded px-1.5 py-0.5 font-mono text-xs font-semibold leading-none';

interface ToneClasses {
    /** 未激活图标按钮的 hover 外观。 */
    idle: string;
    /** 分隔线颜色。 */
    divider: string;
    /** 分段控件外壳配色。 */
    segmented: string;
    /** 分段控件未选中项。 */
    segmentIdle: string;
    /** 分段控件选中项。 */
    segmentActive: string;
    /** 徽章配色。 */
    badge: string;
    /** 三种激活态。 */
    accent: Record<ToolbarAccent, string>;
}

/** 两套底色的取值。新增控件只从这里取，不要在组件里写死颜色。 */
export const TOOLBAR_TONE: Record<ToolbarTone, ToneClasses> = {
    panel: {
        idle: 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
        divider: 'bg-border/70',
        segmented: 'border-border/50 bg-muted/60',
        segmentIdle: 'text-muted-foreground hover:text-foreground',
        segmentActive: 'bg-background text-foreground shadow-xs',
        badge: 'bg-foreground/10 text-foreground',
        accent: {
            amber: 'bg-warning/10 text-warning-text ring-1 ring-warning/25 dark:text-warning-text',
            emerald: 'bg-success/10 text-success-text ring-1 ring-success/25 dark:text-success-text',
            neutral: 'bg-foreground/10 text-foreground',
        },
    },
    overlay: {
        idle: 'text-media-fg/80 hover:bg-media-fg/15 hover:text-media-fg',
        divider: 'bg-media-fg/15',
        segmented: 'border-media-fg/15 bg-media-fg/10',
        segmentIdle: 'text-media-fg/70 hover:text-media-fg',
        segmentActive: 'bg-media-fg/20 text-media-fg shadow-xs',
        badge: 'bg-media-fg/20 text-media-fg',
        accent: {
            amber: 'bg-warning/20 text-warning-text ring-1 ring-warning/30',
            emerald: 'bg-success/25 text-success-text ring-1 ring-success/30',
            neutral: 'bg-media-fg/20 text-media-fg ring-1 ring-media-fg/30',
        },
    },
};
