export type EffectiveThemeMode = 'dark' | 'light' | 'system';
export type MirroredTheme = 'dark' | 'light';

/**
 * 规整首屏镜像读到的主题值（`index.html` 写入 `<html>` 或 `localStorage` 的值）。
 */
export function normalizeMirroredTheme(value: string | null | undefined): MirroredTheme | null {
    return value === 'dark' || value === 'light' ? value : null;
}

/**
 * 计算传给根 `<Theme>` 的模式：
 * 在后端运行时设置尚未水合前沿用首屏镜像，防止 `theme === undefined` 引发
 * `<Theme>` 移除 `data-theme` 或把深色用户首帧重刷回浅色。
 */
export function resolveEffectiveThemeMode(params: {
    settingsInit: boolean;
    mirroredTheme: MirroredTheme | null;
    theme: string | undefined;
    isDarkOnlyTheme: boolean;
}): EffectiveThemeMode {
    if (!params.settingsInit) {
        return params.mirroredTheme ?? 'system';
    }
    if (params.isDarkOnlyTheme) {
        return 'dark';
    }
    if (params.theme === 'dark' || params.theme === 'light') {
        return params.theme;
    }
    return 'system';
}
