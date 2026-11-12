import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-setting-credentials-test',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { SettingServiceImpl } from '@/backend/services/SettingService';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import { SettingKeyObj, type SettingKey } from '@/common/types/store_schema';

/** 测试用假凭据；形态像真实密钥，但都是编出来的。 */
const OPENAI_KEY = 'sk-test-aaaaaaaaaaaaaaaa1234';
const TENCENT_ID = 'AKIDtesttencentsecretid01';
const TENCENT_KEY = 'tencentsecretkey0000wxyz';

/**
 * 内存版设置存储：只实现凭据链路实际用到的 get/set。
 */
const createStore = (initial: Partial<Record<SettingKey, string>> = {}) => {
    // 未显式覆盖的键取 schema 默认值：真实 store 也是这么读的，
    // 否则 apiFormat 之类的枚举字段会是空串而被判非法。
    const values = new Map<string, string>(Object.entries(SettingKeyObj) as Array<[string, string]>);
    for (const [key, value] of Object.entries(initial)) {
        values.set(key, value as string);
    }
    const store = {
        get: vi.fn((key: SettingKey) => values.get(key) ?? ''),
        set: vi.fn((key: SettingKey, value: string) => {
            values.set(key, value);
            return true;
        }),
        has: vi.fn((key: SettingKey) => values.has(key)),
        values,
    };
    return store;
};

const createService = (store: ReturnType<typeof createStore>): SettingServiceImpl => {
    return new SettingServiceImpl(
        { storeUpdate: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
        { createModelById: vi.fn() } as never,
        { get: vi.fn() } as never,
        store as unknown as SettingsStore,
        { getDirectory: vi.fn() } as never,
        { status: vi.fn(), download: vi.fn(), cancelDownload: vi.fn(), deleteModel: vi.fn() } as never,
    );
};

const baseSave = {
    openai: {
        endpoint: 'https://api.example.com/v1',
        apiFormat: 'openai' as const,
        models: ['gpt-4o-mini'],
    },
    tencent: {},
};

describe('服务凭据：不把明文送进渲染进程', () => {
    let store: ReturnType<typeof createStore>;
    let service: SettingServiceImpl;

    beforeEach(() => {
        store = createStore({
            'apiKeys.openAi.key': OPENAI_KEY,
            'apiKeys.openAi.endpoint': 'https://api.example.com/v1',
            'apiKeys.openAi.apiFormat': 'openai',
            'models.openai.available': 'gpt-4o-mini',
            'apiKeys.tencent.secretId': TENCENT_ID,
            'apiKeys.tencent.secretKey': TENCENT_KEY,
        });
        service = createService(store);
    });

    it('详情只给末四位提示，不含密钥本体', async () => {
        const detail = await service.getServiceCredentialsDetail();

        expect(detail.openai.hasKey).toBe(true);
        expect(detail.openai.keyHint).toBe('••••1234');
        const serialized = JSON.stringify(detail);
        expect(serialized).not.toContain(OPENAI_KEY);
        expect(serialized).not.toContain(TENCENT_ID);
        expect(serialized).not.toContain(TENCENT_KEY);
        expect(detail.tencent.hasCredentials).toBe(true);
        expect(detail.tencent.secretIdHint).toBe(`••••${TENCENT_ID.slice(-4)}`);
    });

    it('未配置时 hasKey 为 false 且提示为空', async () => {
        const empty = createService(createStore());
        const detail = await empty.getServiceCredentialsDetail();

        expect(detail.openai.hasKey).toBe(false);
        expect(detail.openai.keyHint).toBe('');
        expect(detail.tencent.hasCredentials).toBe(false);
    });

    /**
     * 设置页是自动保存的：用户只改接口地址时，密钥框是空的。
     * 空值必须理解成「沿用」，否则一次无关的编辑就把凭据抹掉了。
     */
    it('密钥留空时保留已保存的值', async () => {
        await service.saveServiceCredentials({ ...baseSave, openai: { ...baseSave.openai, key: '' } });

        expect(store.values.get('apiKeys.openAi.key')).toBe(OPENAI_KEY);
        expect(store.values.get('apiKeys.tencent.secretKey')).toBe(TENCENT_KEY);
    });

    it('填了新密钥才覆盖', async () => {
        await service.saveServiceCredentials({
            ...baseSave,
            openai: { ...baseSave.openai, key: 'sk-test-newkey-0000000000009999' },
        });

        expect(store.values.get('apiKeys.openAi.key')).toBe('sk-test-newkey-0000000000009999');
    });

    it('显式 clearKey 才清空', async () => {
        await service.saveServiceCredentials({
            ...baseSave,
            openai: { ...baseSave.openai, clearKey: true },
        });

        expect(store.values.get('apiKeys.openAi.key')).toBe('');
    });
});
