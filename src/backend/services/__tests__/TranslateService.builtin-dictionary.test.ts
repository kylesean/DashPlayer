import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 服务模块会经 simple-logger 依赖 electron（读取 userData 路径），
// 与 AiSdkUpgradeIntegration.test.ts 相同的 mock 约定，避免 require 真实 electron 可执行文件。
vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-builtin-dict-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import type AiProviderService from '@/backend/services/AiProviderService';
import { buildDictionaryPrompt, TranslateServiceImpl } from '@/backend/services/TranslateService';
import type SettingService from '@/backend/services/SettingService';
import type WordTranslatesRepository from '@/backend/services/repositories/WordTranslatesRepository';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type LocalAiService from '@/backend/services/LocalAiService';
import type ImportedDictionaryService from '@/backend/services/ImportedDictionaryService';
import type ResourceFallbackService from '@/backend/services/ResourceFallbackService';
import { BuiltinDictionaryStoreImpl } from '@/backend/infrastructure/translate/BuiltinDictionaryStoreImpl';
import { createBuiltinDictionaryFixture } from '@/test/builtinDictionaryFixture';

describe('单词查询的预置词典优先链路', () => {
    let closeFixture: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        closeFixture?.();
        closeFixture = null;
    });

    /**
     * 用真实的预置词典夹具装配 TranslateServiceImpl，其余依赖以边界桩注入。
     *
     * @param options getCurrentDictionaryProvider 的返回值、预置词表及可选本地模型/回退桩。
     */
    const buildService = (options: {
        dictionaryProvider: Promise<'openai' | 'local' | null>;
        words: Parameters<typeof createBuiltinDictionaryFixture>[0];
        localAiService?: Partial<LocalAiService>;
        resourceFallback?: Partial<ResourceFallbackService>;
    }) => {
        const fixture = createBuiltinDictionaryFixture(options.words);
        closeFixture = fixture.close;

        const settingService = {
            getCurrentDictionaryProvider: vi.fn().mockResolvedValue(options.dictionaryProvider),
        } as unknown as SettingService;
        const rendererGateway = {
            call: vi.fn().mockResolvedValue(undefined),
            fireAndForget: vi.fn(),
        } as unknown as RendererGateway;
        const aiProviderService = {
            getModel: vi.fn().mockReturnValue(null),
        } as unknown as AiProviderService;
        const wordTranslatesRepository = {
            findOne: vi.fn().mockResolvedValue(null),
            upsert: vi.fn().mockResolvedValue(undefined),
        } as unknown as WordTranslatesRepository;
        const builtinDictionaryStore = new BuiltinDictionaryStoreImpl(fixture.dbPath);
        const importedDictionaryService = {
            lookup: vi.fn().mockReturnValue(null),
        } as unknown as ImportedDictionaryService;
        const localAiService = {
            getActiveModelId: vi.fn().mockResolvedValue(''),
            generate: vi.fn().mockRejectedValue(new Error('本地模型未配置')),
            ...options.localAiService,
        } as unknown as LocalAiService;
        const resourceFallback = {
            isFallbackActive: vi.fn().mockReturnValue(false),
            clear: vi.fn(),
            markFallback: vi.fn(),
            ...options.resourceFallback,
        } as unknown as ResourceFallbackService;

        const service = new TranslateServiceImpl(
            rendererGateway,
            aiProviderService,
            settingService,
            wordTranslatesRepository,
            builtinDictionaryStore,
            importedDictionaryService,
            localAiService,
            resourceFallback,
        );
        return { service, aiProviderService, wordTranslatesRepository };
    };

    it('未配置任何词典服务时，命中预置词典仍能返回释义', async () => {
        const { service } = buildService({
            dictionaryProvider: Promise.resolve(null),
            words: [{ word: 'cancel', phonetic: "'kænsәl", translation: 'n. 取消', collins: 3 }],
        });

        const result = await service.transWord('cancel');
        if (!result || !('definitions' in result)) {
            throw new Error('预置词典命中时应返回简化单词卡');
        }
        expect(result).toMatchObject({ word: 'cancel', collins: 3 });
        expect(result.definitions).toEqual([{ partOfSpeech: 'n.', meaning: '取消', examples: [] }]);
    });

    it('未配置词典服务且预置词典未命中时返回 null', async () => {
        const { service } = buildService({
            dictionaryProvider: Promise.resolve(null),
            words: [],
        });

        expect(await service.transWord('unknownword')).toBeNull();
    });

    it('强制刷新绕过预置词典：未配置词典服务时返回 null', async () => {
        const { service } = buildService({
            dictionaryProvider: Promise.resolve(null),
            words: [{ word: 'cancel', phonetic: '', translation: 'n. 取消' }],
        });

        expect(await service.transWord('cancel', true)).toBeNull();
    });

    it('已配置词典引擎时预置词典仍然优先，且不触发在线查询', async () => {
        const { service, aiProviderService, wordTranslatesRepository } = buildService({
            dictionaryProvider: Promise.resolve('openai'),
            words: [{ word: 'cancel', phonetic: '', translation: 'n. 取消', bnc: 3183 }],
        });

        const result = await service.transWord('cancel');

        expect(result).toMatchObject({ word: 'cancel', bnc: 3183 });
        // 预置命中即返回，在线链路不应被触发，也不应写入查询缓存
        expect(aiProviderService.getModel).not.toHaveBeenCalled();
        expect(wordTranslatesRepository.upsert).not.toHaveBeenCalled();
    });

    it('带语境时跳过预置词典走引擎，引擎失败回退预置词典', async () => {
        const { service } = buildService({
            dictionaryProvider: Promise.resolve('local'),
            words: [{ word: 'cancel', phonetic: '', translation: 'n. 取消' }],
            localAiService: {
                getActiveModelId: vi.fn().mockResolvedValue('custom:gemma-4-E4B_q4_0-it.gguf'),
                generate: vi.fn().mockRejectedValue(new Error('模型未就绪')),
            },
        });

        const result = await service.transWord('cancel', false, undefined, 'Please cancel the meeting.');
        expect(result).toMatchObject({ word: 'cancel', definitions: [{ partOfSpeech: 'n.', meaning: '取消', examples: [] }] });
    });

    it('带语境且引擎成功时返回语境解释，缓存键编入语境哈希', async () => {
        const { service, wordTranslatesRepository } = buildService({
            dictionaryProvider: Promise.resolve('local'),
            words: [],
            localAiService: {
                getActiveModelId: vi.fn().mockResolvedValue('custom:gemma-4-E4B_q4_0-it.gguf'),
                generate: vi.fn().mockResolvedValue({
                    word: 'cues',
                    phonetic: '/kjuːz/',
                    definitions: [{ partOfSpeech: 'n.', meaning: '（倾听中的）提示信号', examples: [] }],
                }),
            },
        });

        const result = await service.transWord('cues', false, undefined, 'All of the cues that the person is giving to you.');
        expect(result).toMatchObject({ word: 'cues' });
        expect(wordTranslatesRepository.upsert).toHaveBeenCalledWith(
            expect.stringContaining('#ctx:'),
            'local',
            expect.any(String),
            expect.any(String),
        );
    });

    it('词典提示词带语境时包含句子与消歧指令，无语境时不含', () => {
        const withContext = buildDictionaryPrompt('cues', 'All of the cues that the person is giving to you.');
        expect(withContext).toContain('AS USED IN THIS SENTENCE');
        expect(withContext).toContain('All of the cues that the person is giving to you.');
        const withoutContext = buildDictionaryPrompt('cues');
        expect(withoutContext).not.toContain('AS USED IN THIS SENTENCE');
    });
});
