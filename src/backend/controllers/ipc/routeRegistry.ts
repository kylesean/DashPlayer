import type { TraceCarrier } from '@/common/log/simple-types';

import { electronRouteTransport } from './ipcTransport';

/**
 * 单条 IPC 路由的登记信息。
 */
export interface RouteRegistration {
    /** 路由是否携带入参校验 schema（有参路由必须携带，由 registerRoute 的类型签名在编译期强制）。 */
    hasSchema: boolean;
}

/**
 * IPC 路由处理函数签名；与 ipcMain.handle 的回调形状对齐，事件参数保持 unknown。
 */
export type RouteHandler = (
    event: unknown,
    param: unknown,
    traceCarrier?: TraceCarrier,
) => Promise<unknown> | unknown;

/**
 * 路由落点抽象：生产实现把 handler 挂到 Electron ipcMain，测试可替换为纯记录器。
 */
export type RouteTransport = (path: string, handler: RouteHandler) => void;

/** path -> 登记信息。本次启动注册过的全部路由，契约测试据此校验注册集合与清单一致。 */
const registrations = new Map<string, RouteRegistration>();

/** 当前路由落点；默认为 Electron ipcMain，测试可通过 setRouteTransport 替换。 */
let transport: RouteTransport = electronRouteTransport;

/**
 * 注册一条 IPC 路由：登记到路由表并交由当前落点挂载。
 *
 * 重复注册直接抛错而不是静默覆盖——Electron 的 ipcMain.handle 遇到重复路径
 * 只在控制台报错，运行时沿用旧 handler，契约漂移会悄无声息地漏网。
 *
 * @param path API 路径（须与 api-def 的 ApiMap 键一致）。
 * @param hasSchema 路由是否携带入参校验 schema。
 * @param handler IPC 处理函数。
 * @throws 路径已被注册过时抛出。
 */
export function registerIpcRoute(path: string, hasSchema: boolean, handler: RouteHandler): void {
    if (registrations.has(path)) {
        throw new Error(`IPC 路由重复注册：${path}（请核对控制器与 api-def 清单）`);
    }
    registrations.set(path, { hasSchema });
    transport(path, handler);
}

/**
 * 替换路由落点（仅测试使用）；传 null 恢复生产默认的 Electron ipcMain。
 *
 * @param next 新的落点实现。
 */
export function setRouteTransport(next: RouteTransport | null): void {
    transport = next ?? electronRouteTransport;
}

/**
 * 清空路由登记并恢复生产落点；仅测试使用，保证用例间互不串扰。
 */
export function resetRouteRegistry(): void {
    registrations.clear();
    transport = electronRouteTransport;
}

/**
 * 只读视图：本次启动已注册的全部路由。
 *
 * @returns path 到登记信息的只读映射。
 */
export function getRouteRegistrations(): ReadonlyMap<string, RouteRegistration> {
    return registrations;
}
