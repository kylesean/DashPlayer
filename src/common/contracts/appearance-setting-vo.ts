/**
 * 外观主题选项。
 */
export type AppearanceTheme = 'dark' | 'light' | 'system';

/**
 * Astryx 外观主题家族选项。
 */
export type AppearanceThemeFamily = 'neutral' | 'stone' | 'matcha' | 'butter';

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
    /** 主题家族（Neutral/Stone/Matcha/Butter）。 */
    themeFamily?: AppearanceThemeFamily;
    /** 字号。 */
    fontSize: AppearanceFontSize;
    /** 界面语言。 */
    language: AppearanceLanguage;
    /** 伴读剧本流面板停靠方位（右侧默认 / 左侧精读）。 */
    transcriptPosition?: TranscriptPosition;
}
