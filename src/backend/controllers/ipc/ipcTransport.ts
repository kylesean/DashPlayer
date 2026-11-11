import { ipcMain } from 'electron';

import type { RouteTransport } from './routeRegistry';

/**
 * 生产环境唯一的 IPC 路由落点：把 handler 挂到 Electron 主进程 ipcMain。
 *
 * 独立成模块的用意：与 Electron 运行时的耦合只发生在这一处，
 * 路由登记、契约校验与测试替身都保持纯逻辑、无需拉起 Electron。
 */
export const electronRouteTransport: RouteTransport = (path, handler) => {
    ipcMain.handle(path, handler);
};
