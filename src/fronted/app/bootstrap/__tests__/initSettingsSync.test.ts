import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import { initSettingsSync } from '@/fronted/app/bootstrap/initSettingsSync';
import useSetting from '@/fronted/features/settings/settingsStore';
import useTranslation from '@/fronted/features/player/translationStore';
import type { RuntimeSettingsSnapshot } from '@/common/contracts/runtime-settings';

vi.mock('@/fronted/infrastructure/electron/backendClient', () => ({
    backendClient: {
        call: vi.fn(),
    },
}));

vi.mock('@/fronted/infrastructure/electron/rendererEvents', () => ({
    rendererEvents: {
        onStoreUpdate: vi.fn(() => vi.fn()),
    },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('initSettingsSync', () => {
    let stopSync: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        useSetting.setState({ values: new Map(), init: false });
        useTranslation.setState({
            engine: 'none',
            openAiMode: 'zh',
        });
    });

    afterEach(() => {
        stopSync?.();
        stopSync = null;
    });

    it('在 settings/runtime/detail 返回前调用 cleanup，会忽略过期的快照初始化', async () => {
        let resolveSnapshot!: (snapshot: RuntimeSettingsSnapshot) => void;
        vi.mocked(backendClient.call).mockImplementation(
            () => new Promise<RuntimeSettingsSnapshot>((resolve) => {
                resolveSnapshot = resolve;
            }),
        );

        stopSync = initSettingsSync();
        stopSync();
        stopSync = null;

        resolveSnapshot({
            'providers.subtitleTranslation': 'openai',
            'features.openai.subtitleTranslationMode': 'zh',
        } as unknown as RuntimeSettingsSnapshot);
        await Promise.resolve();
        await Promise.resolve();

        expect(useSetting.getState().init).toBe(false);
        expect(useTranslation.getState().engine).toBe('none');
    });
});
