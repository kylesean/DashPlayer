import { beforeEach, describe, expect, it, vi } from 'vitest';

// simple-logger 间接依赖 electron，与相邻服务测试保持同一 mock 约定。
vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-word-insight-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

vi.mock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
        ...actual,
        generateObject: vi.fn(),
    };
});

import { generateObject, type LanguageModel } from 'ai';
import type AiProviderService from '@/backend/services/AiProviderService';
import { CacheServiceImpl } from '@/backend/services/CacheService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type SettingService from '@/backend/services/SettingService';
import {
    buildWordContextInsightPrompt,
    WordContextInsightServiceImpl,
} from '@/backend/services/WordContextInsightService';
import type { WordContextInsightParams } from '@/common/types/wordInsight';

const LOCAL_MODEL_ID = 'qwen3.5-2b-q4_k_m';
const CLOUD_MODEL = { modelId: 'gpt-test' } as unknown as LanguageModel;

const PARAMS: WordContextInsightParams = {
    word: 'cancel',
    sentence: 'Please cancel the meeting.',
    definitions: ['v. 取消'],
};

/**
 * 装配语境解读服务：其余依赖用边界桩，缓存使用真实实现以覆盖命中与并发合并。
 */
const buildService = (options: {
    provider: 'openai' | 'local' | null;
    cloudModel?: LanguageModel | null;
    localReady?: boolean;
    localGenerate?: () => unknown;
}) => {
    const settingService = {
        getCurrentDictionaryProvider: vi.fn().mockResolvedValue(options.provider),
    } as unknown as SettingService;
    const aiProviderService = {
        getModel: vi.fn(() => options.cloudModel ?? null),
    } as unknown as AiProviderService;
    const localAiService = {
        getStatus: vi.fn(async () => ({
            runtimeReady: !!options.localReady,
            models: options.localReady
                ? [{ modelId: LOCAL_MODEL_ID, ready: true }]
                : [],
            activeModelId: options.localReady ? LOCAL_MODEL_ID : '',
        })),
        generate: vi.fn(async () => options.localGenerate?.() ?? {}),
    } as unknown as LocalAiService;
    const cache = new CacheServiceImpl();
    const service = new WordContextInsightServiceImpl(
        settingService,
        aiProviderService,
        localAiService,
        cache,
    );
    return { service, aiProviderService, localAiService, cache };
};

describe('WordContextInsightService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('云端生成成功后写入缓存，第二次请求直接命中缓存', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: { meaning: '取消（会议）', nuance: '及物动词，语气中性' },
        } as never);
        const { service } = buildService({ provider: 'openai', cloudModel: CLOUD_MODEL });

        const first = await service.explain(PARAMS);
        const second = await service.explain(PARAMS);

        expect(first).toMatchObject({
            status: 'ok',
            insight: { meaning: '取消（会议）', source: 'cloud', cached: false },
        });
        expect(second).toMatchObject({
            status: 'ok',
            insight: { cached: true },
        });
        expect(generateObject).toHaveBeenCalledTimes(1);
    });

    it('同一个词在不同句子中不串缓存', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: { meaning: '取消', nuance: '' },
        } as never);
        const { service } = buildService({ provider: 'openai', cloudModel: CLOUD_MODEL });

        await service.explain(PARAMS);
        await service.explain({ ...PARAMS, sentence: 'The cancel button is on the right.' });

        expect(generateObject).toHaveBeenCalledTimes(2);
    });

    it('云端失败时回退本地模型并标记来源', async () => {
        vi.mocked(generateObject).mockRejectedValue(new Error('network down'));
        const { service, localAiService } = buildService({
            provider: 'openai',
            cloudModel: CLOUD_MODEL,
            localReady: true,
            localGenerate: () => ({ meaning: '取消', nuance: '这里作及物动词' }),
        });

        const result = await service.explain(PARAMS);

        expect(result).toMatchObject({
            status: 'ok',
            insight: { meaning: '取消', source: 'local' },
        });
        expect(localAiService.generate).toHaveBeenCalledTimes(1);
    });

    it('本地输出不符合契约时抛错且不写缓存', async () => {
        const { service, cache, localAiService } = buildService({
            provider: 'local',
            localReady: true,
            localGenerate: () => ({ meaning: '', nuance: '缺少含义' }),
        });
        const setSpy = vi.spyOn(cache, 'set');

        await expect(service.explain(PARAMS)).rejects.toThrow('语境解读生成失败');
        expect(setSpy).not.toHaveBeenCalled();

        // 未写缓存，第二次仍会重新推理。
        await expect(service.explain(PARAMS)).rejects.toThrow('语境解读生成失败');
        expect(localAiService.generate).toHaveBeenCalledTimes(2);
    });

    it('同一语境的并发请求只触发一次推理', async () => {
        const deferred: { resolve: (value: unknown) => void } = {
            resolve: () => undefined,
        };
        vi.mocked(generateObject).mockReturnValue(new Promise((resolve) => {
            deferred.resolve = resolve;
        }) as never);
        const { service } = buildService({ provider: 'openai', cloudModel: CLOUD_MODEL });

        const first = service.explain(PARAMS);
        const second = service.explain(PARAMS);
        await vi.waitFor(() => expect(generateObject).toHaveBeenCalledTimes(1));
        deferred.resolve({
            object: { meaning: '取消', nuance: '' },
        });

        await expect(first).resolves.toMatchObject({ status: 'ok' });
        await expect(second).resolves.toMatchObject({ status: 'ok' });
        expect(generateObject).toHaveBeenCalledTimes(1);
    });

    it('AI 关闭与模型未就绪分别返回明确原因', async () => {
        const disabled = buildService({ provider: null });
        await expect(disabled.service.explain(PARAMS)).resolves.toEqual({
            status: 'unavailable',
            reason: 'ai-disabled',
        });

        const unavailable = buildService({ provider: 'local', localReady: false });
        await expect(unavailable.service.explain(PARAMS)).resolves.toEqual({
            status: 'unavailable',
            reason: 'model-unavailable',
        });
    });

    it('提示词包含单词、整句与现有释义，并限制输出为两个短字段', () => {
        const prompt = buildWordContextInsightPrompt(
            'cancel',
            'Please cancel the meeting.',
            ['v. 取消', 'n. 撤销'],
        );

        expect(prompt).toContain('"cancel"');
        expect(prompt).toContain('Please cancel the meeting.');
        expect(prompt).toContain('- v. 取消');
        expect(prompt).toContain('- n. 撤销');
        expect(prompt).toContain('"meaning"');
        expect(prompt).toContain('"nuance"');
    });
});
