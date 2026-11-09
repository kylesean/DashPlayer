import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { getMainLogger } from '@/backend/infrastructure/logger';

const logger = getMainLogger('RendererSecurity');

/**
 * 渲染进程安全守卫的安装参数。
 */
export interface RendererSecurityOptions {
    /**
     * 开发模式下的 Vite dev server 地址；生产模式传 undefined。
     *
     * 开发模式的页面来源是 http://localhost:<port>，导航与权限判定都要以它为准。
     */
    devServerUrl?: string;
    /**
     * 生产模式下渲染进程产物目录（index.html 所在目录）的绝对路径。
     *
     * 生产模式的页面来源是 file:// 下的 index.html；file:// 的 origin 是不可靠的
     * （所有 file:// 页面共享同一个 "null" origin），所以这里不按 origin 判定，
     * 而是按「路径是否落在渲染进程目录内」判定。
     */
    rendererDirectory?: string;
}

/**
 * 判断一个 URL 是否是应用自己的页面。
 *
 * @param url 待判定的 URL 字符串。
 * @param options 守卫参数。
 * @returns 是应用页面时为 true。
 */
const isAppPageUrl = (url: string, options: RendererSecurityOptions): boolean => {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }

    if (options.devServerUrl) {
        try {
            return new URL(options.devServerUrl).origin === parsed.origin;
        } catch {
            return false;
        }
    }

    if (parsed.protocol !== 'file:') {
        return false;
    }
    if (!options.rendererDirectory) {
        return false;
    }
    try {
        const rendererDirectory = path.resolve(options.rendererDirectory);
        const targetPath = path.resolve(decodeURIComponent(parsed.pathname));
        const relativePath = path.relative(rendererDirectory, targetPath);
        return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
    } catch {
        return false;
    }
};

/**
 * 安装渲染进程的安全守卫。
 *
 * 装三道闸：
 * 1. **导航守卫**：页面被导航到应用之外时拦下来。preload 是挂在 webContents 上的，
 *    窗口一旦导航到外部页面，那个页面同样能调用全部 IPC 路由（含读云端凭据的
 *    `settings/service-credentials/detail`）。
 * 2. **开窗守卫**：`window.open` 一律拒绝。应用要打开外部链接走
 *    `system/open-url`，那条路由带 https-only 的 schema 校验。
 * 3. **权限守卫**：只放行录音（跟读练习要录麦克风），其余权限请求一律拒绝。
 *    Electron 默认会批准大部分权限请求。
 *
 * @param window 主窗口。
 * @param options 守卫参数。
 */
export const installRendererSecurityGuards = (
    window: BrowserWindow,
    options: RendererSecurityOptions,
): void => {
    const webContents = window.webContents;

    webContents.on('will-navigate', (event, url) => {
        if (isAppPageUrl(url, options)) {
            return;
        }
        logger.warn('renderer navigation blocked', { url });
        event.preventDefault();
    });

    webContents.on('will-redirect', (event, url) => {
        if (isAppPageUrl(url, options)) {
            return;
        }
        logger.warn('renderer redirect blocked', { url });
        event.preventDefault();
    });

    webContents.setWindowOpenHandler(() => {
        // 不给开新窗口的口子：需要打开外部链接时用 system/open-url。
        logger.warn('renderer window.open blocked');
        return { action: 'deny' };
    });

    webContents.session.setPermissionRequestHandler((_contents, permission, callback, details) => {
        const requestingUrl = details.requestingUrl ?? '';
        const isOwnPage = isAppPageUrl(requestingUrl, options);
        if (permission === 'media' && isOwnPage) {
            // 跟读练习要录麦克风，摄像头一律不给。
            // Electron 用同一个 'media' 权限表示摄像头与麦克风，靠 mediaTypes 区分。
            const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
            const wantsCamera = Array.isArray(mediaTypes) && mediaTypes.includes('video');
            const wantsAudio = Array.isArray(mediaTypes) && mediaTypes.includes('audio');
            if (!wantsCamera && (wantsAudio || mediaTypes === undefined)) {
                callback(true);
                return;
            }
        }
        logger.warn('renderer permission denied', { permission, requestingUrl });
        callback(false);
    });
};
