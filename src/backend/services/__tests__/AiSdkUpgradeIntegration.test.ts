import { describe, it, expect, vi } from 'vitest';

// 服务模块会经 simple-logger 依赖 electron（读取 userData 路径），
// vitest 下必须 mock，否则 require('electron') 只返回可执行文件路径字符串。
// userData 指向临时目录，保证日志等写入不落在真实应用目录。
vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-ai-sdk-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
    shell: { openPath: vi.fn() },
}));

// electron-store 是外部化 CJS 依赖，vitest 里 vi.mock('electron') 拦不到它内部的 require，
// 会导致它回落到 ~/Library/Preferences 等真实目录写入配置（曾把开发 Key 写出去）。
// 因此把应用 store 模块整体 mock 成内存实现，测试数据只存在于内存，绝不落盘。
// 与生产 storeGet 行为一致：未写入的键回落到 SettingKeyObj 里的默认值（如 apiKeys.openAi.apiFormat 默认 'openai'）。
import { SettingKeyObj } from '@/common/types/store_schema';
import type { SettingKey } from '@/common/types/store_schema';
const storeState = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('@/backend/infrastructure/settings/store', () => ({
    storeGet: (key: string) => storeState.values.get(key) ?? SettingKeyObj[key as SettingKey] ?? '',
    storeSet: (key: string, value: string) => {
        storeState.values.set(key, value);
        return true;
    },
    subscribeSettingChange: () => () => undefined,
}));

import { z } from 'zod';
import { Output, streamText, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { loadAiSdkTestConfig } from '@/test/aiSdkTestConfig';
import { splitSystemMessages } from '@/backend/services/chat/ChatPromptBuilder';
import { TranslateServiceImpl } from '../TranslateService';
import { BuiltinDictionaryStoreImpl } from '@/backend/infrastructure/translate/BuiltinDictionaryStoreImpl';
import { createBuiltinDictionaryFixture } from '@/test/builtinDictionaryFixture';
import { AiProviderServiceImpl } from '../AiProviderService';
import { ModelRoutingServiceImpl } from '../ModelRoutingService';
import type AiProviderService from '../AiProviderService';
import type SettingService from '../SettingService';
import type LocalAiService from '../LocalAiService';
import type ImportedDictionaryService from '../ImportedDictionaryService';
import type EnglishDictionaryService from '../EnglishDictionaryService';
import type ResourceFallbackService from '../ResourceFallbackService';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type WordTranslatesRepository from '@/backend/services/repositories/WordTranslatesRepository';

// 真实连接测试默认不跑（会发起计费请求）：需显式设置 DP_RUN_LIVE_AI_TESTS=true，
// 且开发环境配置文件（config.dev.json）里已配置 Key 时才执行。
const testConfig = loadAiSdkTestConfig();
const liveTestsEnabled = process.env.DP_RUN_LIVE_AI_TESTS === 'true';
const describeLive = liveTestsEnabled && testConfig ? describe : describe.skip;

/**
 * 构造一个与生产 getModel 完全一致的直连测试模型：
 * @ai-sdk/openai-compatible 的 chat 模型（只走 /chat/completions，避开官方 provider 默认的
 * Responses API，uniapi 代理对 deepseek 的 Responses 流式实现不完整）。
 *
 * @param modelId 要使用的模型 id。
 * @returns 可直接传给 streamText 的 LanguageModel。
 */
const buildLiveModel = (modelId: string): LanguageModel => {
    const provider = createOpenAICompatible({
        name: 'openai',
        baseURL: testConfig!.endpoint,
        apiKey: testConfig!.key,
    });
    return provider.chatModel(modelId);
};


const runTests = (): void => {
    // 离线回归：不发真实请求，默认测试（yarn test）就能跑，守护整句学习面板的模型调用与流式回推路径。
    describe('整句学习面板（AI SDK v7 离线回归）', () => {
        describe('splitSystemMessages（system 消息拆分）', () => {
            it('能把开头 system 消息拆出并保留剩余消息', () => {
                const { system, messages } = splitSystemMessages([
                    { role: 'system', content: '你是学习伙伴' },
                    { role: 'user', content: '用户问题' },
                    { role: 'assistant', content: '助手回答' },
                ]);
                expect(system).toBe('你是学习伙伴');
                expect(messages).toEqual([
                    { role: 'user', content: '用户问题' },
                    { role: 'assistant', content: '助手回答' },
                ]);
            });

            it('多个 system 消息按原顺序用空行拼接', () => {
                const { system, messages } = splitSystemMessages([
                    { role: 'system', content: '第一条' },
                    { role: 'user', content: '问题' },
                    { role: 'system', content: '第二条' },
                ]);
                expect(system).toBe('第一条\n\n第二条');
                expect(messages).toEqual([{ role: 'user', content: '问题' }]);
            });

            it('没有 system 消息时返回 undefined 且消息不变', () => {
                const { system, messages } = splitSystemMessages([
                    { role: 'user', content: '问题' },
                ]);
                expect(system).toBeUndefined();
                expect(messages).toEqual([{ role: 'user', content: '问题' }]);
            });
        });


    });

    describeLive('AI SDK 升级验证（ai v7 + @ai-sdk/openai-compatible）', () => {
        describe('streamText 文本流（聊天/欢迎语等通用路径）', () => {
            it('真实连接：messages 输入能流式产出文本并正常结束', async () => {
                const result = streamText({
                    model: buildLiveModel(testConfig!.model),
                    messages: [
                        { role: 'user', content: 'Reply with exactly: hello' },
                    ],
                });
                let collected = '';
                for await (const chunk of result.textStream) {
                    collected += chunk;
                }
                expect(collected.trim().length).toBeGreaterThan(0);
                expect(collected.toLowerCase()).toContain('hello');
            }, 60000);

        });

        describe('Output.object 结构化输出（分析/字幕/词典等路径）', () => {
            it('真实连接：结构化对象流能产出完整且 schema 合法的对象', async () => {
                const schema = z.object({
                    translation: z.string(),
                });
                const result = streamText({
                    model: buildLiveModel(testConfig!.model),
                    output: Output.object({ schema }),
                    prompt: 'Translate "hello world" to Simplified Chinese, respond with JSON matching the schema.',
                });
                const partials: Array<Partial<{ translation: string }>> = [];
                for await (const partial of result.partialOutputStream) {
                    partials.push(partial ?? {});
                }
                const finalObject = await result.output;
                expect(partials.length).toBeGreaterThan(0);
                expect(finalObject).toBeDefined();
                expect(schema.safeParse(finalObject).success).toBe(true);
            }, 60000);
        });

        describe('AiProviderServiceImpl（应用真实取模型路径）', () => {
            it('真实连接：开发配置里的 Key 经 electron-store 取模型后能完成一次文本流', async () => {
                // Key/endpoint/模型路由字段与开发环境配置文件（config.dev.json）一致，写进隔离的测试 store 后走应用真实取模型路径。
                const { storeSet } = await import('@/backend/infrastructure/settings/store');
                storeSet('apiKeys.openAi.key', testConfig!.key);
                storeSet('apiKeys.openAi.endpoint', testConfig!.endpoint);
                if (testConfig!.availableModels.length > 0) {
                    storeSet('models.openai.available', testConfig!.availableModels.join('\n'));
                }
                if (testConfig!.sentenceLearningModel) {
                    storeSet('models.openai.sentenceLearning', testConfig!.sentenceLearningModel);
                }

                const routingService = new ModelRoutingServiceImpl();
                const providerService = new AiProviderServiceImpl(routingService);

                const model = providerService.getModel('sentenceLearning');
                expect(model).not.toBeNull();
                const result = streamText({
                    model: model!,
                    prompt: 'Reply with exactly: provider-ok',
                });
                let collected = '';
                for await (const chunk of result.textStream) {
                    collected += chunk;
                }
                expect(collected.trim().length).toBeGreaterThan(0);
            }, 60000);
        });


        describe('TranslateServiceImpl（词典路径）', () => {
            const rendererEvents: Array<{ path: string; params: Record<string, unknown> }> = [];

            const buildService = (overrides: {
                getModel?: (scene: string) => LanguageModel | null;
                findOne?: () => Promise<unknown>;
            } = {}): TranslateServiceImpl => {
                const aiProvider: AiProviderService = {
                    getModel: (scene) => (overrides.getModel
                        ? overrides.getModel(scene)
                        : buildLiveModel(testConfig!.model)),
                    createModelById: () => buildLiveModel(testConfig!.model),
                };
                const settingService: SettingService = {
                    getServiceCredentialsDetail: vi.fn(),
                    saveServiceCredentials: vi.fn(),
                    getRuntimeSettings: vi.fn(),
                    saveRuntimeSetting: vi.fn(),
                    getEngineSelectionDetail: vi.fn(),
                    saveEngineSelection: vi.fn(),
                    saveTranscriptionEngine: vi.fn(),
                    getShortcutSettingsDetail: vi.fn(),
                    saveShortcutSettings: vi.fn(),
                    getAppearanceSettingDetail: vi.fn(),
                    saveAppearanceSettings: vi.fn(),
                    getStorageSettingDetail: vi.fn(),
                    saveStorageSettings: vi.fn(),
                    getProxySettingDetail: vi.fn(),
                    saveProxySettings: vi.fn(),
                    getCurrentSentenceLearningProvider: vi.fn().mockResolvedValue('openai'),
                    getCurrentTranslationProvider: vi.fn().mockResolvedValue('openai'),
                    getOpenAiSubtitleTranslationMode: vi.fn().mockResolvedValue('zh'),
                    getOpenAiSubtitleCustomStyle: vi.fn().mockResolvedValue(''),
                    getCurrentDictionaryProvider: vi.fn().mockResolvedValue('openai'),
                    getSherpaTtsVoice: vi.fn().mockReturnValue('en-US-amy-low'),
                    saveSherpaTtsVoice: vi.fn().mockResolvedValue(undefined),
                    testOpenAi: vi.fn(),
                    testTencent: vi.fn(),
                };
                const gateway: RendererGateway = {
                    call: vi.fn(async (_path: never, params: Record<string, unknown>) => {
                        rendererEvents.push({ path: _path as string, params });
                    }) as RendererGateway['call'],
                    fireAndForget: vi.fn(),
                };
                const wordRepo: WordTranslatesRepository = {
                    findOne: vi.fn().mockResolvedValue(overrides.findOne?.() ?? null),
                    upsert: vi.fn(),
                    deleteByProvider: vi.fn().mockResolvedValue(0),
                };
                const builtinFixture = createBuiltinDictionaryFixture([
                    { word: 'serendipity', phonetic: '', translation: 'n. 意外发现珍奇事物的运气' },
                ]);
                const importedDictionaryService = {
                    lookup: vi.fn().mockReturnValue(null),
                } as unknown as ImportedDictionaryService;
                const englishDictionaryService = {
                    lookup: vi.fn().mockReturnValue(null),
                } as unknown as EnglishDictionaryService;
                const localAiService = {
                    getActiveModelId: vi.fn().mockResolvedValue(''),
                    generate: vi.fn().mockRejectedValue(new Error('未配置本地模型')),
                } as unknown as LocalAiService;
                const resourceFallback = {
                    isFallbackActive: vi.fn().mockReturnValue(false),
                    clear: vi.fn(),
                    markFallback: vi.fn(),
                } as unknown as ResourceFallbackService;
                const service = new TranslateServiceImpl(
                    gateway,
                    aiProvider,
                    settingService,
                    wordRepo,
                    new BuiltinDictionaryStoreImpl(builtinFixture.dbPath),
                    importedDictionaryService,
                    englishDictionaryService,
                    localAiService,
                    resourceFallback,
                );
                return service;
            };

            it('真实连接：transWord() 通过结构化输出返回词典结果', async () => {
                const service = buildService();
                const result = await service.transWord('serendipity', true);
                expect(result).not.toBeNull();
                if (result && 'definitions' in result) {
                    expect(result.word.toLowerCase()).toBe('serendipity');
                    expect(result.definitions.length).toBeGreaterThan(0);
                }
            }, 60000);
        });
    });
};

runTests();
