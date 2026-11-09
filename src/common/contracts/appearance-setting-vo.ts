/**
 * 外观主题选项。
 */
export type AppearanceTheme = 'dark' | 'light' | 'system';

/**
 * 合法的 Astryx 主题家族。
 *
 * 与 `src/themes/` 下的本地主题一一对应（本地 slug 带 `dp-` 前缀，见 App.tsx 的映射）。
 * 校验与 UI 共用这一份清单，避免后端枚举、前端选项、主题包三处漂移。
 */
export const APPEARANCE_THEME_FAMILIES = [
    'neutral',
    'stone',
    'gothic',
    'matcha',
    'y2k',
    'butter',
    'chocolate',
] as const;

/**
 * Astryx 外观主题家族选项。
 */
export type AppearanceThemeFamily = (typeof APPEARANCE_THEME_FAMILIES)[number];

/**
 * 外观字号选项。
 */
export type AppearanceFontSize = 'fontSizeSmall' | 'fontSizeMedium' | 'fontSizeLarge';

/**
 * 伴读剧本流面板停靠方位。
 */
export type TranscriptPosition = 'right' | 'left';

/**
 * 界面语言选项。
 */
export type AppearanceLanguage = 'system' | 'zh-CN' | 'en-US';

/**
 * 外观设置详情/保存值对象。
 *
 * 详情与保存结构一致，统一在一个类型中，避免为相同字段结构重复声明。
 */
export interface AppearanceSettingVO {
    /** 颜色模式（浅色/暗色/跟随系统）。 */
    theme: AppearanceTheme;
    /** 主题家族（Astryx 官方 Neutral/Stone/Gothic/Matcha/Y2K/Butter/Chocolate）。 */
    themeFamily?: AppearanceThemeFamily;
    /** 字号。 */
    fontSize: AppearanceFontSize;
    /** 界面语言。 */
    language: AppearanceLanguage;
    /** 伴读剧本流面板停靠方位（右侧默认 / 左侧精读）。 */
    transcriptPosition?: TranscriptPosition;
}
