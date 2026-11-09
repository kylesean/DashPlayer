export type FontSizeType =
    | 'ms1-small'
    | 'ms1-medium'
    | 'ms1-large'
    | 'ms2-small'
    | 'ms2-medium'
    | 'ms2-large'
    | 'ms3-small'
    | 'ms3-medium'
    | 'ms3-large';

export const FONT_SIZE: {
    [key in FontSizeType]: string;
} = {
    'ms1-small': 'text-[length:calc(1.25rem*var(--sub-scale,1))]',
    'ms1-medium': 'text-[length:calc(1.5rem*var(--sub-scale,1))]',
    'ms1-large': 'text-[length:calc(1.875rem*var(--sub-scale,1))]',
    'ms2-small': 'text-[length:calc(1.125rem*var(--sub-scale,1))]',
    'ms2-medium': 'text-[length:calc(1.25rem*var(--sub-scale,1))]',
    'ms2-large': 'text-[length:calc(1.5rem*var(--sub-scale,1))]',
    'ms3-small': 'text-[length:calc(1rem*var(--sub-scale,1))]',
    'ms3-medium': 'text-[length:calc(1.125rem*var(--sub-scale,1))]',
    'ms3-large': 'text-[length:calc(1.25rem*var(--sub-scale,1))]',
};
export type ColorType =
    | 'bg-background'
    | 'bg-wordHoverBackground'
    | 'bg-sentenceInnerShadow'
    | 'text-textColor'
    | 'text-mainSubtitleOneColor'
    | 'text-mainSubtitleTwoColor'
    | 'bg-scrollbarTrack'
    | 'bg-scrollbarThumb'
    | 'bg-scrollbarThumbHover'
    | 'bg-progressbarComplete'
    | 'bg-gutterBackground'
    | 'bg-titlebar'
    | 'bg-titlebarHover'
    | 'text-titlebarText'
    | 'bg-uploadButton'
    | 'bg-playIcon'
    | 'bg-settingButton'
    | 'bg-settingButtonHover';

export const lightColor: {
    [key in ColorType]: string;
} = {
    'bg-background': 'bg-body',
    'bg-wordHoverBackground': 'bg-muted',
    'bg-sentenceInnerShadow': 'bg-muted/50',
    'text-textColor': 'text-primary',
    'text-mainSubtitleOneColor': 'text-primary',
    'text-mainSubtitleTwoColor': 'text-secondary',
    'bg-scrollbarTrack': 'bg-transparent',
    'bg-scrollbarThumb': 'bg-border',
    'bg-scrollbarThumbHover': 'bg-border-emphasized',
    'bg-progressbarComplete': 'bg-accent-bg',
    'bg-gutterBackground': 'bg-body',
    'bg-titlebar': 'bg-surface',
    'bg-titlebarHover': 'bg-muted',
    'text-titlebarText': 'text-primary',
    'bg-uploadButton': 'bg-surface',
    'bg-playIcon': 'bg-accent-bg',
    'bg-settingButton': 'bg-surface',
    'bg-settingButtonHover': 'bg-muted',
};

export const darkColor: {
    [key in ColorType]: string;
} = {
    'bg-background': 'bg-body',
    'bg-wordHoverBackground': 'bg-muted',
    'bg-sentenceInnerShadow': 'bg-muted/50',
    'text-textColor': 'text-primary',
    'text-mainSubtitleOneColor': 'text-primary',
    'text-mainSubtitleTwoColor': 'text-secondary',
    'bg-scrollbarTrack': 'bg-transparent',
    'bg-scrollbarThumb': 'bg-border',
    'bg-scrollbarThumbHover': 'bg-border-emphasized',
    'bg-progressbarComplete': 'bg-accent-bg',
    'bg-gutterBackground': 'bg-body',
    'bg-titlebar': 'bg-surface',
    'bg-titlebarHover': 'bg-muted',
    'text-titlebarText': 'text-primary',
    'bg-uploadButton': 'bg-surface',
    'bg-playIcon': 'bg-accent-bg',
    'bg-settingButton': 'bg-surface',
    'bg-settingButtonHover': 'bg-muted',
};

export const themeProvider = (
    theme: string
): ((style: ColorType) => string) => {
    return (style: ColorType): string => {
        if (theme === 'light') {
            return lightColor[style];
        }
        return darkColor[style];
    };
};

export default class Style {
    public static file_browser_icon = 'w-4 h-4 text-yellow-700/90 flex-shrink-0';
    // 隐藏英文字幕时的单词占位：纯透明占位保留排版，通过整行磨砂遮罩或整行 hover 优雅显现
    public static word_hover_bg = 'select-none';
}


