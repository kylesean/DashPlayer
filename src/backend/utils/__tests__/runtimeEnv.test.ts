import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
    app: {
        get isPackaged() {
            return electronState.isPackaged;
        },
    },
}));

import {
    getEnvironmentConfigName,
    getEnvironmentSuffix,
    getRuntimeResourcePath,
    isDevelopmentMode,
} from '../runtimeEnv';

/** 允许测试覆盖 Electron 在运行时注入的只读进程属性。 */
const setProcessProperty = (key: string, value: unknown): void => {
    Object.defineProperty(process, key, { value, configurable: true });
};

describe('runtimeEnv', () => {
    beforeEach(() => {
        electronState.isPackaged = false;
        delete process.env.NODE_ENV;
        // 默认模拟普通 Node/打包进程：没有 defaultApp，也没有 Electron resourcesPath。
        setProcessProperty('defaultApp', undefined);
        setProcessProperty('resourcesPath', undefined);
    });

    it('未打包运行时为开发态', () => {
        expect(isDevelopmentMode()).toBe(true);
    });

    it('Electron 45 开发态（isPackaged=true 且 defaultApp=true）仍判定为开发态', () => {
        electronState.isPackaged = true;
        setProcessProperty('defaultApp', true);
        expect(isDevelopmentMode()).toBe(true);
    });

    it('打包后即使 NODE_ENV=development 也不是开发态', () => {
        electronState.isPackaged = true;
        process.env.NODE_ENV = 'development';
        expect(isDevelopmentMode()).toBe(false);
    });

    it('打包后 NODE_ENV=production 仍不是开发态', () => {
        electronState.isPackaged = true;
        process.env.NODE_ENV = 'production';
        expect(isDevelopmentMode()).toBe(false);
    });

    it('开发态按仓库目录解析资源，并追加 dev 后缀', () => {
        setProcessProperty('resourcesPath', '/opt/DashPlayer/resources');
        expect(getRuntimeResourcePath('drizzle', 'migrations')).toBe(
            path.resolve('drizzle', 'migrations'),
        );
        expect(getEnvironmentSuffix()).toBe('-dev');
        expect(getEnvironmentConfigName('config')).toBe('config.dev');
    });

    it('打包态按 resourcesPath 解析资源，且不加 dev 后缀', () => {
        electronState.isPackaged = true;
        setProcessProperty('resourcesPath', '/opt/DashPlayer/resources');
        expect(getRuntimeResourcePath('drizzle', 'migrations')).toBe(
            path.join('/opt/DashPlayer/resources', 'drizzle', 'migrations'),
        );
        expect(getEnvironmentSuffix()).toBe('');
        expect(getEnvironmentConfigName('config')).toBe('config');
    });
});
