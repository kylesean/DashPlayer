/**
 * 判断键盘事件目标是否为文本输入区域。
 *
 * 练习界面的全局快捷键在用户输入文字时必须让位，否则会吞掉正常字符输入。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/**
 * 判断键盘事件目标是否为可交互控件。
 *
 * 当焦点落在按钮、链接或自定义控件上时，Enter/Space/方向键属于该控件的原生语义，
 * 全局快捷键必须放行，否则键盘与读屏用户无法激活界面。
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(
        el.closest(
            'button, a[href], input, select, textarea, summary, [contenteditable="true"], '
            + '[role="button"], [role="link"], [role="checkbox"], [role="radio"], '
            + '[role="switch"], [role="tab"], [role="menuitem"], [role="option"]',
        ),
    );
}

/**
 * 判断当前运行平台是否为 Apple（macOS / iPadOS / iOS），用于快捷键提示符号适配。
 */
export function isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const platform = uaData?.platform && uaData.platform !== 'Unknown'
        ? uaData.platform
        : (navigator.platform ?? '');
    return /Mac|iPhone|iPad|iPod/i.test(platform);
}
