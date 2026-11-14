/**
 * 把快捷键配置渲染成提示后缀。
 *
 * 控制条上的 tooltip 统一用「动作 (快捷键)」的格式；没有配置时不追加空括号。
 *
 * @param key 快捷键文本；空字符串表示未配置。
 * @returns 形如 " (E)" 的后缀，未配置时为空字符串。
 */
export function formatShortcut(key?: string): string {
    return key ? ` (${key})` : '';
}
