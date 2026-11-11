import path from 'path';
import { app } from 'electron';

export const isDevelopmentMode = (): boolean => {
    // 只认 Electron 的运行时事实，不认 NODE_ENV：打包应用从带 NODE_ENV=development
    // 的终端启动时，后者会把 __dpDebug、?file= 与 dev 数据目录重新暴露出来。
    //
    // 不能只信 app.isPackaged：Electron 45 起，开发态（electron .）也会返回 true，
    // 导致迁移目录被解析到 electron dist 内。process.defaultApp 只在以
    // 「默认应用」方式启动（electron <appPath>）时为 true，打包产物为 undefined，
    // 因此二者任一成立即为开发态；打包态两个条件都不成立，行为不变。
    return !app.isPackaged || Boolean(process.defaultApp);
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
