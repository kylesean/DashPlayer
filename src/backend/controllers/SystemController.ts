import { z } from 'zod';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema, windowStateSchema } from '@/backend/controllers/ipc/routeSchemas';
import { app, dialog, shell, systemPreferences } from 'electron';
import path from 'path';
import type { WindowState } from '@/common/types/Types';
import { readSystemInfo } from '@/backend/utils/systemInfo';
import { isDevelopmentMode } from '@/backend/utils/runtimeEnv';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import StrUtil from '@/common/utils/str-util';
import TYPES from '@/backend/ioc/types';
import OpenDialogOptions = Electron.OpenDialogOptions;
import type WindowPort from '@/backend/services/gateways/window/WindowPort';
import type { UpdateCheckResult } from '@/common/types/update-check';
import { RESET_DB_RESYNC_FLAG } from '@/common/constants/resetDb';
import type SystemService from '@/backend/services/SystemService';

/**
 * 过滤并移除文件扩展名前导点号（例如 `.mkv` 转为 `mkv`）。
 *
 * @param filter 原始扩展名列表。
 * @returns 归一化后的扩展名列表。
 */
function processFilter(filter: string[]) {
    return filter
        .filter(f => StrUtil.isNotBlank(f))
        .map(f => f.replace(/^\./, ''));
}

/**
 * 系统与窗口交互 IPC 控制器。
 */
@injectable()
export default class SystemController implements Controller {
    /**
     * 构造系统控制器。
     *
     * @param windowPort 窗口状态控制端口。
     * @param systemService 系统业务服务。
     */
    constructor(
        @inject(TYPES.WindowPort) private readonly windowPort: WindowPort,
        @inject(TYPES.SystemService) private readonly systemService: SystemService,
    ) {}

    /**
     * 读取当前运行平台与硬件概览信息。
     *
     * @returns 包含系统平台、开发模式标记和硬件信息的对象。
     */
    public async info() {
        const platform = process.platform;
        const hardware = await readSystemInfo();
        return {
            isWindows: platform === 'win32',
            isMac: platform === 'darwin',
            isLinux: platform === 'linux',
            pathSeparator: path.sep,
            // 与 main 进程判定同源：打包后为 false，renderer 的调试/QA 能力据此开关
            devMode: isDevelopmentMode(),
            ...hardware,
        };
    }

    /**
     * 打开系统文件选择对话框。
     *
     * @param filter 允许的文件扩展名列表。
     * @returns 用户选中的文件绝对路径列表。
     */
    public async selectFile(filter: string[]): Promise<string[]> {
        const f = processFilter(filter);
        const files = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{
                name: 'Files',
                extensions: f
            }]
        });
        return files.filePaths;
    }

    /**
     * 打开系统目录选择对话框。
     *
     * @param options 默认目录与是否允许新建目录选项。
     * @returns 用户选中的目录绝对路径列表。
     */
    public async selectFolder({ defaultPath, createDirectory }: { defaultPath?: string, createDirectory?: boolean }): Promise<string[]> {
        const options: OpenDialogOptions = {
            properties: ['openDirectory']
        };
        if (defaultPath) {
            options.defaultPath = defaultPath;
        }
        if (createDirectory) {
            options.properties?.push('createDirectory');
        }
        const files = await dialog.showOpenDialog(options);
        return files.filePaths;
    }

    /**
     * 拆分路径的basename、父目录和扩展名。
     *
     * @param p 目标路径。
     * @returns 路径各组成部分。
     */
    public async pathInfo(p: string): Promise<{
        baseName: string,
        dirName: string,
        extName: string,
    }> {
        return {
            baseName: path.basename(p),
            dirName: path.dirname(p),
            extName: path.extname(p)
        };
    }

    /**
     * 清空数据库并重启应用以触发媒体库回灌。
     */
    public async resetDb() {
        await this.systemService.resetDatabase();
        app.relaunch({ args: [...process.argv.slice(1), RESET_DB_RESYNC_FLAG] });
        app.quit();
    }

    /**
     * 打开指定路径所在的文件夹；仅在显式允许时创建不存在的目录。
     *
     * @param request 文件路径或目录路径，以及是否在打开前创建目录。
     *                路径本身是目录时直接打开该目录；是文件或尚不存在时打开其父目录。
     */
    public async openFolder(request: { path: string; createDirectory?: boolean }): Promise<void> {
        const folder = await this.systemService.prepareFolderForOpen(request);
        const error = await shell.openPath(folder);
        if (error) {
            throw new Error(`打开文件夹失败：${error}`);
        }
    }

    /**
     * 设置窗口控制按钮显隐状态（仅 macOS 生效）。
     *
     * @param visible 是否显示窗口按钮。
     */
    public async setWindowButtonsVisible(visible: boolean) {
        this.windowPort.setWindowButtonsVisible(visible);
    }

    /**
     * 切换主窗口状态。
     *
     * @param state 目标窗口状态。
     */
    public async changeWindowSize(state: WindowState) {
        this.windowPort.changeWindowSize(state);
    }

    /**
     * 查询当前主窗口状态。
     *
     * @returns 主窗口当前状态。
     */
    public async windowState(): Promise<WindowState> {
        return this.windowPort.windowState();
    }

    /**
     * 检查应用更新，并在弹窗模式下返回是否需要提醒。
     *
     * @param params 检查模式参数。
     * @returns 更新检查结果。
     */
    public async checkUpdate(params?: { mode?: 'toast' }): Promise<UpdateCheckResult> {
        return this.systemService.checkUpdate(app.getVersion(), params);
    }

    /**
     * 调用系统默认浏览器打开外部链接。
     *
     * @param url 目标 URL。
     */
    public async openUrl(url: string) {
        await shell.openExternal(url);
    }

    /**
     * 确保应用已获得 macOS 麦克风授权，未决定时弹出系统授权框。
     *
     * Electron 渲染进程的 getUserMedia 在 macOS 上不会触发系统 TCC 授权框；
     * 未授权时 Chromium 也不报错，只会给出一条全静音的音轨（录音会采到无声）。
     * 因此录音前必须由主进程显式请求授权。其余平台没有这道闸门，直接视为已授权。
     *
     * @returns 授权状态；仅 'granted' 表示可以录音。
     */
    public async ensureMicrophone(): Promise<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'> {
        if (process.platform !== 'darwin') {
            return 'granted';
        }
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status !== 'not-determined') {
            return status;
        }
        return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
    }

    /**
     * 获取当前应用版本号。
     *
     * @returns 应用版本号字符串。
     */
    public async appVersion() {
        return app.getVersion();
    }

    /**
     * 读取指定系统配置。
     *
     * @param key 配置键。
     * @returns 配置值；不存在时返回 `null`。
     */
    public async getSystemConfig(key: string): Promise<string | null> {
        return this.systemService.getSystemConfig(key);
    }

    /**
     * 保存指定系统配置。
     *
     * @param params 配置键值参数。
     */
    public async setSystemConfig(params: { key: string; value: string }): Promise<void> {
        await this.systemService.setSystemConfig(params.key, params.value);
    }

    /**
     * 打开当前媒体库根目录。
     *
     * 行为说明：
     * - 仅当媒体库目录健康可访问时才允许打开；
     * - 目录异常时直接抛出显式错误，交由前端提示用户重新选择。
     */
    public async openCacheDir() {
        const libraryRoot = await this.systemService.resolveCacheDirectory();
        await shell.openPath(libraryRoot);
    }

    /**
     * 注册系统与窗口相关 IPC 路由。
     */
    public registerRoutes(): void {
        registerRoute('system/info', () => this.info());
        registerRoute('system/select-file', (p) => this.selectFile(p), {
            schema: z.array(z.string()),
        });
        registerRoute('system/select-folder', (p) => this.selectFolder(p), {
            schema: z.object({
                defaultPath: z.string().optional(),
                createDirectory: z.boolean().optional(),
            }),
        });
        registerRoute('system/path-info', (p) => this.pathInfo(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('system/reset-db', () => this.resetDb());
        registerRoute('system/open-folder', (p) => this.openFolder(p), {
            schema: z.object({
                path: nonEmptyStringSchema,
                createDirectory: z.boolean().optional(),
            }),
        });
        registerRoute('system/open-folder/cache', () => this.openCacheDir());
        registerRoute('system/window-size/change', (p) => this.changeWindowSize(p), {
            schema: windowStateSchema,
        });
        registerRoute('system/window-size', () => this.windowState());
        registerRoute('system/window-buttons/visibility', (visible) => this.setWindowButtonsVisible(visible), {
            schema: z.boolean(),
        });
        registerRoute('system/check-update', (p) => this.checkUpdate(p), {
            schema: z.object({ mode: z.enum(['toast']).optional() }).optional(),
        });
        registerRoute('system/open-url', (p) => this.openUrl(p), {
            schema: z.url({ protocol: /^https?$/ }),
        });
        registerRoute('system/app-version', () => this.appVersion());
        registerRoute('system/ensure-microphone', () => this.ensureMicrophone());
        registerRoute('system/config/get', (key) => this.getSystemConfig(key), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('system/config/set', (p) => this.setSystemConfig(p), {
            schema: z.object({
                key: nonEmptyStringSchema,
                value: z.string(),
            }),
        });
    }
}
