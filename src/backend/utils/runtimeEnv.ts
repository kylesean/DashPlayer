import path from 'path';
import { app } from 'electron';

export const isDevelopmentMode = (): boolean => {
    // 只认 Electron 的打包事实，不认 NODE_ENV：打包应用从带 NODE_ENV=development
    // 的终端启动时，后者会把 __dpDebug、?file= 与 dev 数据目录重新暴露出来。
    return !app.isPackaged;
};

export const getEnvironmentSuffix = (): string => {
    return isDevelopmentMode() ? '-dev' : '';
};

export const getEnvironmentConfigName = (baseName: string): string => {
    return `${baseName}${isDevelopmentMode() ? '.dev' : ''}`;
};

export const getRuntimeResourcePath = (...segments: string[]): string => {
    if (isDevelopmentMode()) {
        return path.resolve(...segments);
    }

    return path.join(process.resourcesPath, ...segments);
};
