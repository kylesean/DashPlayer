import { describe, expect, it, vi } from 'vitest';

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { SubtitleTranslationServiceImpl } from '@/backend/services/subtitle-translation/SubtitleTranslationService';
import type SettingService from '@/backend/services/SettingService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type CacheService from '@/backend/services/CacheService';
import type ModelRoutingService from '@/backend/services/ModelRoutingService';
import type SentenceTranslatesRepository from '@/backend/services/repositories/SentenceTranslatesRepository';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type ClientProviderService from '@/backend/services/ClientProviderService';
import type { TencentTranslateClient } from '@/backend/services/gateways/translate/TencentTranslateClient';
import type OpenAiSubtitleBatchTranslator from '@/backend/services/gateways/translate/OpenAiSubtitleBatchTranslator';
import type LocalSubtitleBatchTranslator from '@/backend/services/gateways/translate/LocalSubtitleBatchTranslator';
import type ResourceFallbackService from '@/backend/services/ResourceFallbackService';

describe('SubtitleTranslationService updateDemand 与 releaseSession 竞态', () => {
    it('updateDemand 等待配置解析期间若会话已 releaseSession，不应复活已关闭会话', async () => {
        let resolveProvider!: (v: 'tencent') => void;
        const settingService = {
            getCurrentTranslationProvider: vi.fn().mockImplementation(
                () => new Promise<'tencent'>((resolve) => {
                    resolveProvider = resolve;
                }),
            ),
        } as unknown as SettingService;

        const cacheService = {
            get: vi.fn().mockReturnValue({
                sentences: [{ index: 0, text: 'hello', startTime: 0, endTime: 1 }],
            }),
        } as unknown as CacheService;

        const service = new SubtitleTranslationServiceImpl(
            settingService,
            {} as LocalAiService,
            cacheService,
            {} as ModelRoutingService,
            {} as SentenceTranslatesRepository,
            {} as RendererGateway,
            {} as ClientProviderService<TencentTranslateClient>,
            {} as OpenAiSubtitleBatchTranslator,
            {} as LocalSubtitleBatchTranslator,
            { clear: vi.fn(), markFallback: vi.fn() } as unknown as ResourceFallbackService,
        );

        const schedulerUpdateSpy = vi.spyOn(
            (service as unknown as { scheduler: { updateDemand: (d: unknown) => void } }).scheduler,
            'updateDemand',
        );

        const pendingDemand = service.updateDemand({
            fileHash: 'hash-1',
            currentIndex: 0,
            demandId: 1,
            rendererSessionId: 'renderer-a',
        });

        // 在异步解析尚未完成前释放会话
        service.releaseSession('hash-1', 'renderer-a');
        resolveProvider('tencent');
        await pendingDemand;

        expect(schedulerUpdateSpy).not.toHaveBeenCalled();
    });
});
