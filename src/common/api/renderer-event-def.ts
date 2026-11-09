import type { SimpleEvent } from '@/common/log/simple-types';

/**
 * 渲染进程 → 主进程的单向事件通道。
 *
 * 与 api-def.ts 里的 ApiMap 不同：这些通道走 ipcRenderer.send，
 * 是 fire-and-forget 的单向通知，没有返回值，也不走 registerRoute 的 zod 校验。
 * 单独建一份契约，是为了这些通道同样受类型检查约束，
 * 而不是像以前那样把 'dp-log/write' 这样的字符串散落在 preload 与主进程两处。
 */
export interface RendererEventDefinitions {
    /** 渲染进程把日志事件送到主进程落盘。 */
    'dp-log/write': SimpleEvent;
}

/**
 * 渲染进程 → 主进程事件通道名与载荷的映射。
 */
export type RendererEventMap = {
    [K in keyof RendererEventDefinitions]: RendererEventDefinitions[K];
};

/**
 * 合法的渲染进程 → 主进程事件通道名。
 */
export type RendererEventChannel = keyof RendererEventMap;
