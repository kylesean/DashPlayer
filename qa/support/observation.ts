import type { ElectronApplication, Page } from '@playwright/test';

/**
 * Electron 进程级退出记录。
 *
 * `render-process-gone` / `child-process-gone` 不经过 JS 异常通道：渲染进程 SIGSEGV、
 * GPU 进程崩溃在页面断言上可能完全无感，用例照样绿。这里在主进程注册一次性监听，
 * 由 fixture 在收尾时取走并按类型判定。
 */
export interface ProcessGoneRecord {
    event: 'render-process-gone' | 'child-process-gone';
    /** child-process-gone 才有：GPU / Utility / NetworkService 等。 */
    processType?: string;
    reason: string;
    exitCode?: number;
    webContentsId?: number;
    url?: string;
    name?: string;
    serviceName?: string;
}

/** 页面级观测句柄。 */
export interface PageObservation {
    /** 取走未捕获异常（会判红）。 */
    takePageErrors: () => string[];
    /** 取走 console.error（只作证据，不直接判红）。 */
    takeConsoleErrors: () => string[];
}

/**
 * 在主进程注册进程退出监听。
 *
 * 必须在 `firstWindow()` 之前调用，否则启动阶段的渲染进程崩溃会漏掉。
 *
 * @param app Playwright Electron 应用句柄。
 */
export async function installProcessObserver(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ app: electronApp }) => {
        const holder = globalThis as typeof globalThis & {
            __qaProcessGone?: Array<Record<string, unknown>>;
        };
        holder.__qaProcessGone = [];
        electronApp.on('render-process-gone', (_event, contents, details) => {
            holder.__qaProcessGone?.push({
                event: 'render-process-gone',
                reason: details.reason,
                exitCode: details.exitCode,
                webContentsId: contents.id,
                url: contents.getURL(),
            });
        });
        electronApp.on('child-process-gone', (_event, details) => {
            holder.__qaProcessGone?.push({
                event: 'child-process-gone',
                processType: details.type,
                reason: details.reason,
                exitCode: details.exitCode,
                name: details.name,
                serviceName: details.serviceName,
            });
        });
    });
}

/**
 * 取走主进程记录的进程退出事件。
 *
 * 应用已经崩溃时 `evaluate` 会失败；此时返回空数组，由页面/断言错误承担归因，
 * 不能让观测代码把原始失败覆盖掉。
 *
 * @param app Playwright Electron 应用句柄。
 * @returns 进程退出记录。
 */
export async function takeProcessGone(app: ElectronApplication): Promise<ProcessGoneRecord[]> {
    try {
        return await app.evaluate(() => {
            const holder = globalThis as typeof globalThis & {
                __qaProcessGone?: ProcessGoneRecord[];
            };
            const records = holder.__qaProcessGone ?? [];
            holder.__qaProcessGone = [];
            return records;
        });
    } catch {
        return [];
    }
}

/**
 * 判断进程退出是否属于产品故障。
 *
 * 渲染进程非正常退出直接判红；GPU 崩溃单独归为环境异常（NVIDIA/Wayland 驱动常见），
 * 其它 Utility/NetworkService 崩溃只留证据，避免把宿主环境噪音误报成产品回归。
 *
 * @param record 进程退出记录。
 * @returns 需要判红时返回 true。
 */
export function isFatalProcessGone(record: ProcessGoneRecord): boolean {
    if (record.event !== 'render-process-gone') {
        return false;
    }
    // 只有正常退出可以放过；killed 意味着被 OS/OOM 或外部强制终止，同样属于
    // 运行期故障。把 killed 当作非致命会让「用例绿但渲染进程已被杀」漏过去。
    return record.reason !== 'clean-exit';
}

/**
 * 安装页面级观测。
 *
 * @param page 应用主窗口页面。
 * @returns 取走错误的函数。
 */
export function observePage(page: Page): PageObservation {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('crash', () => {
        pageErrors.push('页面渲染进程崩溃（page crash）');
    });
    return {
        takePageErrors: () => pageErrors.splice(0, pageErrors.length),
        takeConsoleErrors: () => consoleErrors.splice(0, consoleErrors.length),
    };
}
