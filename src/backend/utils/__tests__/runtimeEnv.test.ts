import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
    app: {
        get isPackaged() {
            return electronState.isPackaged;
        },
    },
}));

import { isDevelopmentMode } from '../runtimeEnv';

describe('runtimeEnv', () => {
    beforeEach(() => {
        electronState.isPackaged = false;
        delete process.env.NODE_ENV;
    });

    it('未打包运行时为开发态', () => {
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
});
