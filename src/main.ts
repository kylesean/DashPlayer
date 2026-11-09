import 'dotenv/config';
import 'reflect-metadata';
import type LocalAiService from '@/backend/services/LocalAiService';
import { app, BrowserWindow, protocol, type Session } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import registerHandler from '@/backend/dispatcher';
import { setConcurrencyLogger } from '@/backend/utils/concurrency';
import { seedDefaultVocabularyIfNeeded } from '@/backend/startup/seedDefaultVocabulary';
import type DpTaskService from '@/backend/services/DpTaskService';
import runStartupMigrations from '@/backend/startup/runStartupMigrations';
import { getMigrationFailure } from '@/backend/startup/migrationFailureState';
import { initProxyFeature } from '@/backend/startup/initProxy';
import container from '@/backend/ioc/inversify.config';
import TYPES from '@/backend/ioc/types';
import type { VideoLearningService } from '@/backend/services/VideoLearningService';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { initProcessWatchdog } from '@/backend/startup/initProcessWatchdog';
import { initLogMaintenance } from '@/backend/startup/initLogMaintenance';
import { RESET_DB_RESYNC_FLAG } from '@/common/constants/resetDb';
import { isDevelopmentMode } from '@/backend/utils/runtimeEnv';
import { storeGet } from '@/backend/infrastructure/settings/store';
import type MobileAccessService from '@/backend/services/MobileAccessService';
import type RendererEvents from '@/backend/services/gateways/renderer/RendererEvents';
import { MEDIA_PROTOCOL_SCHEME, registerMediaProtocol } from '@/backend/infrastructure/media/MediaProtocol';
import { installRendererSecurityGuards } from '@/backend/infrastructure/system/RendererSecurityGuard';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type MediaPathRegistry from '@/backend/services/MediaPathRegistry';

// 导入日志 IPC 监听
import '@/backend/controllers/ipc/renderer-log';

if (squirrelStartup) {
    app.quit();
}

const logger = getMainLogger('MainStartup');
const devtoolsLogger = getMainLogger('devtools');
const startupStartedAt = performance.now();
// 组合根运行期注入并发工具日志端口，保持通用工具不依赖基础设施。
setConcurrencyLogger(getMainLogger('concurrency'));
// 进程级崩溃不经过 JS 异常通道，监听必须在任何初始化工作之前挂上。
initProcessWatchdog();
// JS 层未捕获异常落盘与日志目录预算清理，紧随进程级监听。
initLogMaintenance();

/**
 * 注册本地媒体协议。
 *
 * 必须在 app ready 之前完成：Electron 只在 ready 之前接受特权协议声明，
 * 之后再调用 registerSchemesAsPrivileged 不会生效。
 *
 * 为什么需要自定义协议：渲染端要播放媒体库里的本地视频，`file://` 页面在
 * `webSecurity` 打开后无法读取同源的 `file://` 子资源；改成 `media://` 之后，
 * 渲染端拿到的是标准安全源，由主进程按目录归属做授权后再返回文件内容。
 */
protocol.registerSchemesAsPrivileged([
    {
        scheme: MEDIA_PROTOCOL_SCHEME,
        privileges: {
            // 让 URL 按 media://host/path 的标准形态解析。
            standard: true,
            // 视作安全源，渲染端可以像加载 https 资源一样加载媒体。
            secure: true,
            supportFetchAPI: true,
            // <video>/<audio> 的 Range 拖动播放依赖流式响应。
            stream: true,
            // 不给协议开后门：后续的 CSP 仍然对 media:// 生效。
            bypassCSP: false,
            corsEnabled: false,
        },
    },
]);

/**
 * 记录主进程启动阶段耗时，统一使用进程启动后的相对毫秒数。
 * @param phase 已完成的启动阶段名称。
 */
const logStartupPhase = (phase: string): void => {
    logger.info('startup phase completed', {
        phase,
        durationMs: Math.round(performance.now() - startupStartedAt),
    });
};

const mainWindowRef = {
    current: null as BrowserWindow | null
};

/**
 * 单实例锁：同一时刻只允许一个应用实例运行。
 *
 * 为什么必须在任何数据库迁移之前获取：两个实例并行启动会各自跑一遍启动迁移、
 * 各自拉起本地推理子进程、争抢手机访问端口，并互相覆盖设置写入，
 * 结果是迁移冲突、端口占用与设置来回翻转。
 * 抢不到锁的实例立刻退出，把启动意图交还给先启动的那个实例。
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    logger.info('another instance is already running, quit current one');
    app.quit();
} else {
    // 第二个实例启动时把已有实例的窗口带到前台，避免用户以为应用没反应。
    app.on('second-instance', () => {
        const window = mainWindowRef.current;
        if (!window || window.isDestroyed()) {
            return;
        }
        if (window.isMinimized()) {
            window.restore();
        }
        window.show();
        window.focus();
    });
}

/**
 * 判断本次启动是否由“重置数据库”触发。
 * @returns 命令行参数中是否包含重同步标记。
 */
const shouldResyncAfterResetDb = (): boolean => {
    return process.argv.includes(RESET_DB_RESYNC_FLAG);
};

/**
 * 在重置数据库后的首次启动执行本地文件回灌。
 *
 * 行为说明：
 * - 以本地收藏/学习片段目录为准，重建数据库索引。
 * - 任一同步失败仅记录日志，不阻断主窗口启动。
 */
const runResyncAfterResetDbIfNeeded = async (): Promise<void> => {
    if (!shouldResyncAfterResetDb()) {
        return;
    }

    try {
        const videoLearningService = container.get<VideoLearningService>(TYPES.VideoLearningService);

        await videoLearningService.syncFromOss();

        logger.info('Resync after reset-db completed');
    } catch (error) {
        logger.error('Resync after reset-db failed', { error });
    }
};

const installReactDevToolsFromChromeProfile = async (targetSession: Session): Promise<boolean> => {
    const extensionId = REACT_DEVELOPER_TOOLS.id;
    const home = app.getPath('home');
    const candidates: string[] = [];

    if (process.platform === 'darwin') {
        candidates.push(
            path.join(home, 'Library/Application Support/Google/Chrome/Default/Extensions', extensionId)
        );
        candidates.push(
            path.join(home, 'Library/Application Support/Microsoft Edge/Default/Extensions', extensionId)
        );
    } else if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            candidates.push(
                path.join(localAppData, 'Google/Chrome/User Data/Default/Extensions', extensionId)
            );
            candidates.push(
                path.join(localAppData, 'Microsoft/Edge/User Data/Default/Extensions', extensionId)
            );
        }
    } else {
        candidates.push(path.join(home, '.config/google-chrome/Default/Extensions', extensionId));
        candidates.push(path.join(home, '.config/microsoft-edge/Default/Extensions', extensionId));
    }

    for (const baseDir of candidates) {
        try {
            const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
            const versions = entries
                .filter((e) => e.isDirectory())
                .map((e) => e.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));

            const latest = versions[0];
            if (!latest) {
                continue;
            }

            const extensionDir = path.join(baseDir, latest);
            await targetSession.extensions.loadExtension(extensionDir, { allowFileAccess: true });
            devtoolsLogger.info('React DevTools loaded from Chrome profile', { extensionDir });
            return true;
        } catch {
            // ignore and try next candidate
        }
    }

    return false;
};

const installReactDevTools = async (targetSession: Session): Promise<void> => {
    try {
        await installExtension(REACT_DEVELOPER_TOOLS, { forceDownload: false, session: targetSession });
        devtoolsLogger.info('React DevTools installed via electron-devtools-installer');
        return;
    } catch (error) {
        devtoolsLogger.warn('Failed to install React DevTools via downloader', { error });
    }

    const loaded = await installReactDevToolsFromChromeProfile(targetSession);
    if (!loaded) {
        devtoolsLogger.warn('React DevTools not installed (no downloader access and no local Chrome/Edge extension found)');
    }
};

/**
 * 创建主窗口并加载渲染端入口。
 *
 * 行为说明：
 * - 开发模式加载 Vite dev server 并尝试安装 React DevTools；
 * - 生产模式直接加载打包后的 renderer 文件。
 */
const createWindow = () => {
    logger.info('main window created');
    // Create the browser window.
    const isMac = process.platform === 'darwin';
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            // 本地媒体改由 media:// 协议提供，同源策略不再需要关闭。
            webSecurity: true,
        },
        ...(isMac
            ? {
                frame: true,
                titleBarStyle: 'hiddenInset' as const,
            }
            : {
                frame: false,
            }),
    });
    mainWindowRef.current = mainWindow;
    // 窗口几何状态推送给渲染端：系统手势/F11/WM 最大化不经过 renderer 的
    // change 请求，标题栏的窗口状态缓存需要显式失效，否则按钮图标失真。
    const pushWindowState = (): void => {
        const win = mainWindowRef.current;
        if (!win || win.isDestroyed()) {
            return;
        }
        const state = win.isFullScreen()
            ? 'fullscreen'
            : win.isMinimized()
                ? 'minimized'
                : win.isMaximized()
                    ? 'maximized'
                    : 'normal';
        container.get<RendererEvents>(TYPES.RendererEvents).windowStateUpdate(state);
    };
    for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'minimize'] as const) {
        // 五个事件的回调签名同为 () => void，Electron 类型按逐事件重载声明，
        // 统一以 maximize 的签名挂接即可
        mainWindow.on(event as 'maximize', pushWindowState);
    }
    mainWindow.webContents.once('dom-ready', () => {
        logger.info('renderer dom ready', {
            durationMs: Math.round(performance.now() - startupStartedAt),
        });
    });
    mainWindow.webContents.once('did-finish-load', () => {
        logger.info('renderer finished loading', {
            durationMs: Math.round(performance.now() - startupStartedAt),
        });
        // GPU 加速特性（含视频硬解）要等首次渲染后才稳定，因此环境快照记在这里而不是 app ready。
        logger.info('gpu feature status', {
            gpuFeatureStatus: app.getGPUFeatureStatus(),
        });
    });
    // 安全守卫：导航、开窗与权限三道闸。
    // 必须在 loadURL/loadFile 之前装上，否则首个页面加载不受管控。
    installRendererSecurityGuards(mainWindow, {
        devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
        rendererDirectory: path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
    });
    // and load the index.html of the app.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        void installReactDevTools(mainWindow.webContents.session).then(() => {
            const installed = mainWindow.webContents.session.extensions
                .getAllExtensions()
                .some((ext) => ext.id === REACT_DEVELOPER_TOOLS.id);
            devtoolsLogger.info('React DevTools extension present', { installed });
        });
        mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
        // Open the DevTools.
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
    }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
    // 没拿到单实例锁的进程不进入任何启动流程：迁移、后台任务与窗口创建全部跳过。
    if (!hasSingleInstanceLock) {
        return;
    }
    // 本地媒体协议处理器：渲染端通过 media:// 读取媒体库文件，
    // 必须在建窗之前注册，否则首屏加载视频会直接失败。
    registerMediaProtocol(
        container.get<StorageDirectoryProvider>(TYPES.StorageDirectoryProvider),
        container.get<MediaPathRegistry>(TYPES.MediaPathRegistry),
    );
    try {
        await runStartupMigrations();
    } catch (error) {
        logger.error('startup migrations failed, entering recovery mode', { error });
    }
    if (getMigrationFailure() !== null) {
        // 恢复模式：迁移未完成，业务控制器与后台任务全部不启动（它们依赖数据库），
        // 只注册恢复路由并建窗，由前端 gate 页引导用户重试或重置。
        logger.warn('entering migration recovery mode');
        registerHandler(mainWindowRef, { recoveryMode: true });
        createWindow();
        return;
    }
    logStartupPhase('migrations');
    // 数据库迁移完成后再解析控制器，避免服务的 postConstruct 提前访问未建表数据库。
    registerHandler(mainWindowRef);
    logStartupPhase('controllers');
    await seedDefaultVocabularyIfNeeded();
    await container.get<DpTaskService>(TYPES.DpTaskService).recoverInterruptedTasks();
    // 清理超过保留期的终态任务：遗留的活动任务刚被标记为取消，同时清掉更早的历史行。
    await container.get<DpTaskService>(TYPES.DpTaskService).cleanupExpiredTasks();
    logStartupPhase('background recovery');
    await runResyncAfterResetDbIfNeeded();
    await initProxyFeature();
    logStartupPhase('proxy');
    // 手机访问：设置里开启过就恢复监听；端口占用等失败只记日志并留给设置页提示。
    await container.get<MobileAccessService>(TYPES.MobileAccessService).startFromSettings();
    logStartupPhase('mobile access');
    // 本地引擎启用时后台预加载模型常驻内存；失败只记日志，不阻塞也不影响启动流程。
    container.get<LocalAiService>(TYPES.LocalAiService).syncEngineResidency();
    // 生命周期标记：会话何时开始、以什么配置运行，便于回溯“有活动却无日志”的问题。
    logger.info('app ready', {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        runtimeVersions: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
        },
        mode: isDevelopmentMode() ? 'development' : 'production',
        proxyMode: storeGet('proxy.mode'),
    });
    createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    logger.info('all windows closed', { platform: process.platform });
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
/**
 * 退出兜底超时。
 *
 * 正常退出是秒级：本地模型子进程最多等 3s 自然退出，手机访问只是关监听。
 */
const QUIT_FORCE_EXIT_TIMEOUT_MS = 8_000;

/** 退出流程所处阶段。 */
type ShutdownPhase = 'idle' | 'stopping' | 'ready';

let shutdownPhase: ShutdownPhase = 'idle';

/**
 * 部署退出兜底：超时后如果本进程还活着，从外部直接 SIGKILL。
 *
 * 为什么不用 JS 定时器：卡死发生在 Electron 关掉 JS 环境之后的清理阶段，那时定时器不会再跑。
 * 实测一个卡在文件读上的线程池请求（等一个没人点的 TCC 授权弹窗就会这样）能让 app.quit()、
 * app.exit(0) 甚至 process.exit(0) 全部退不掉，只有来自进程外的信号能把它杀掉，
 * 所以这里起一个脱离父进程的 shell 来收尾；正常退出时它醒来发现进程已经没了，自行结束。
 *
 * 硬杀必须连子进程一起：主进程被 SIGKILL 后，子进程会被 launchd 收养、继续卡在原来的读上
 * （实测漏了 5 个 ffprobe），所以先杀直接子进程再杀自己；Windows 用 taskkill /t 直接杀整棵进程树。
 */
const armForceExitWatchdog = (): void => {
    const pid = process.pid;
    const seconds = Math.ceil(QUIT_FORCE_EXIT_TIMEOUT_MS / 1000);
    const command = process.platform === 'win32'
        ? `timeout /t ${seconds} /nobreak >nul & taskkill /f /t /pid ${pid}`
        : `sleep ${seconds}; for child in $(pgrep -P ${pid}); do [ "$child" = "$$" ] || kill -9 "$child" 2>/dev/null; done; kill -9 ${pid} 2>/dev/null`;
    const watchdog = spawn(command, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    watchdog.on('error', (error) => {
        logger.warn('quit watchdog failed to start', { error });
    });
    watchdog.unref();
};

/**
 * 退出前释放本地模型进程和手机访问监听，避免后台遗留进程、端口占用和长连接卡住退出。
 *
 * 这段收尾会把退出拦下来（preventDefault），所以这里必须保证最终还能退出：
 * - 收尾期间重复的退出请求（右键 Dock 退出、Cmd+Q 连按、系统注销）直接忽略，
 *   不再重复关闭同一批服务；只有本函数的 app.quit() 会把状态推到 ready 放行；
 * - 收尾或随后的 Electron/Node 清理一旦卡住，由外部兜底进程硬杀（见 armForceExitWatchdog）。
 */
app.on('before-quit', (event) => {
    if (shutdownPhase === 'ready') {
        return;
    }
    // 没拿到单实例锁的进程从未启动任何服务，直接放行退出。
    if (!hasSingleInstanceLock) {
        shutdownPhase = 'ready';
        return;
    }
    event.preventDefault();
    if (shutdownPhase === 'stopping') {
        logger.info('app quit requested while shutting down');
        return;
    }
    shutdownPhase = 'stopping';
    logger.info('app before quit', { forceExitAfterMs: QUIT_FORCE_EXIT_TIMEOUT_MS });
    armForceExitWatchdog();
    try {
        const localAiShutdown = container.get<LocalAiService>(TYPES.LocalAiService).shutdown()
            .catch((error) => {
                logger.error('local AI shutdown failed', { error });
            });
        const mobileAccessShutdown = container.get<MobileAccessService>(TYPES.MobileAccessService).shutdown()
            .catch((error) => {
                logger.error('mobile access shutdown failed', { error });
            });
        void Promise.allSettled([localAiShutdown, mobileAccessShutdown]).finally(() => {
            shutdownPhase = 'ready';
            app.quit();
        });
    } catch (error) {
        // 容器未初始化等同步异常也必须继续退出，否则应用会卡在“退不出”状态。
        logger.error('service shutdown failed', { error });
        shutdownPhase = 'ready';
        app.quit();
    }
});
app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (!hasSingleInstanceLock) {
        return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
