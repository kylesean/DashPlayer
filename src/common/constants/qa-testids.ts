/**
 * 产品与 e2e 共用的稳定定位标识。
 *
 * 只放「结构性容器/导航」这类无法用 role + 可访问名称稳定表达的元素；
 * 按钮、tab、dialog 仍应优先用 role + accessible name。
 * 产品侧与 qa/ 共用同一份常量，改名会在 tsc 阶段直接失败。
 */

/** 主导航条目。 */
export const NAV_TESTIDS = {
    home: 'nav-home',
    player: 'nav-player',
    reader: 'nav-reader',
    vocabulary: 'nav-vocabulary',
    settings: 'nav-settings',
} as const;

/** 设置中心左侧导航容器。 */
export const SETTINGS_SIDEBAR_TESTID = 'settings-sidebar';

/** 设置中心左侧栏目导航。 */
export const SETTINGS_NAV_TESTIDS = {
    shortcut: 'settings-nav-shortcut',
    appearance: 'settings-nav-appearance',
    resources: 'settings-nav-resources',
    storage: 'settings-nav-storage',
    proxy: 'settings-nav-proxy',
    mobile: 'settings-nav-mobile',
    import: 'settings-nav-import',
    about: 'settings-nav-about',
} as const;

/** 设置中心栏目键。 */
export type SettingsSectionKey = keyof typeof SETTINGS_NAV_TESTIDS;

/** 设置行容器标识。 */
export const SETTING_ROW_TESTIDS = {
    subtitleTranslation: 'setting-row-subtitle-translation',
    subtitleStyle: 'setting-row-subtitle-style',
    dictionary: 'setting-row-dictionary',
    sentenceLearning: 'setting-row-sentence-learning',
    transcription: 'setting-row-transcription',
    apiFormat: 'setting-row-api-format',
    language: 'setting-row-language',
} as const;

/** 设置行键。 */
export type SettingRowKey = keyof typeof SETTING_ROW_TESTIDS;
