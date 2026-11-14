/**
 * 整句学习工作台“左上角微画中画”停靠目标的轻量级 DOM 订阅桥。
 *
 * Layout.tsx 通过 ResizeObserver 测量此占位槽的窗口几何坐标，将唯一的
 * `<PlaybackStage>` 包装容器定位停靠至此位置，从而全程不卸载 `<video>`。
 */
let currentTarget: HTMLDivElement | null = null;
const listeners = new Set<(el: HTMLDivElement | null) => void>();

export function setMiniStageTargetEl(el: HTMLDivElement | null): void {
    if (currentTarget === el) return;
    currentTarget = el;
    listeners.forEach((fn) => fn(el));
}

export function getMiniStageTargetEl(): HTMLDivElement | null {
    return currentTarget;
}

export function subscribeMiniStageTarget(listener: (el: HTMLDivElement | null) => void): () => void {
    listeners.add(listener);
    listener(currentTarget);
    return () => {
        listeners.delete(listener);
    };
}
