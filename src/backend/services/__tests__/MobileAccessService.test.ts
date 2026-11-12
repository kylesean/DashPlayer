import { beforeEach, describe, expect, it, vi } from 'vitest';

let nextStartHook: (() => Promise<void>) | null = null;

const serverInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    setToken: ReturnType<typeof vi.fn>;
    tokenHistory: string[];
}> = [];

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        default: { ...actual, existsSync: vi.fn().mockReturnValue(true) },
        existsSync: vi.fn().mockReturnValue(true),
    };
});

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/backend/utils/runtimeEnv', () => ({
    getRuntimeResourcePath: () => '/virtual/resources/mobile',
    isDevelopmentMode: () => true,
}));

vi.mock('@/backend/infrastructure/mobile/MobileWebServer', () => ({
    ClientRequestError: class ClientRequestError extends Error {},
    default: class MockMobileWebServer {
        public start = vi.fn(() => (nextStartHook ? nextStartHook() : Promise.resolve()));
        public stop = vi.fn().mockResolvedValue(undefined);
        public tokenHistory: string[];
        public setToken = vi.fn((t: string) => {
            this.tokenHistory.push(t);
        });
        constructor(options: { token: string }) {
            this.tokenHistory = [options.token];
            serverInstances.push(this);
        }
    },
}));

import { MobileAccessServiceImpl } from '@/backend/services/MobileAccessService';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type WatchHistoryService from '@/backend/services/WatchHistoryService';
import type SubtitleService from '@/backend/services/SubtitleService';
import type TranslateService from '@/backend/services/TranslateService';
import type MediaService from '@/backend/services/MediaService';
import type SubtitleTranslationService from '@/backend/services/subtitle-translation/SubtitleTranslationService';

describe('MobileAccessService 生命周期串行化', () => {
    let settingsMap: Map<string, string>;
    let service: MobileAccessServiceImpl;

    beforeEach(() => {
        serverInstances.length = 0;
        settingsMap = new Map([
            ['mobileAccess.enabled', 'true'],
            ['mobileAccess.port', '27182'],
            ['mobileAccess.token', 'initial_token_at_least_32_characters_long'],
        ]);
        const settingsStore = {
            get: vi.fn((k: string) => settingsMap.get(k)),
            set: vi.fn((k: string, v: string) => {
                settingsMap.set(k, v);
                return true;
            }),
        } as unknown as SettingsStore;

        service = new MobileAccessServiceImpl(
            settingsStore,
            {} as WatchHistoryService,
            {} as SubtitleService,
            {} as TranslateService,
            {} as MediaService,
            {} as SubtitleTranslationService,
        );
    });

    it('start 期间调用 shutdown 必须停掉服务并避免孤儿监听', async () => {
        let releaseStart!: () => void;
        nextStartHook = () => new Promise<void>((resolve) => {
            releaseStart = resolve;
        });

        const startPromise = service.startFromSettings();
        await vi.waitFor(() => expect(serverInstances).toHaveLength(1));

        // start 尚未结束时触发 shutdown：disposed / lifecycleQueue 必须保证停掉该实例并保持 stopped
        const shutdownPromise = service.shutdown();
        nextStartHook = null;
        releaseStart();

        await Promise.all([startPromise, shutdownPromise]);

        expect(serverInstances[0].stop).toHaveBeenCalledTimes(1);
        expect(service.getDetail().running).toBe(false);
    });

    it('start 尚未落座前调用 regenerateToken，启动完成后应同步最新令牌', async () => {
        const startPromise = service.startFromSettings();
        const newToken = service.regenerateToken();
        await startPromise;

        const instance = serverInstances[0];
        expect(instance.tokenHistory[instance.tokenHistory.length - 1]).toBe(newToken);
    });
});
