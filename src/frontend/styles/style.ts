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
export default class Style {
    // 隐藏英文字幕时的单词占位：纯透明占位保留排版，通过整行磨砂遮罩或整行 hover 优雅显现
    public static word_hover_bg = 'select-none';
}


