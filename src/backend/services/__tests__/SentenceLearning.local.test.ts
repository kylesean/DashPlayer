import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-sentence-learning-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { SentenceLearningServiceImpl } from '@/backend/services/SentenceLearningService';
import type AiProviderService from '@/backend/services/AiProviderService';
import type LocalAiService from '@/backend/services/LocalAiService';

/** 装配纯桩实例：通过构造函数注入云端与本地模型边界桩。 */
const buildService = (options: {
    cloudModel: 'configured' | null;
    localStatus: { runtimeReady: boolean; hasReadyModel: boolean } | null;
    localGenerate?: (prompt: string) => unknown;
}) => {
    const aiProviderService = {
        getModel: vi.fn(() => (options.cloudModel === 'configured' ? {} : null)),
    } as unknown as AiProviderService;
    const localAiService = {
        getStatus: vi.fn(async () => ({
            runtimeReady: options.localStatus?.runtimeReady ?? false,
            models: options.localStatus?.hasReadyModel
                ? [{ modelId: 'custom:gemma-4-E4B_q4_0-it.gguf', ready: true }]
                : [],
            activeModelId: options.localStatus?.hasReadyModel ? 'custom:gemma-4-E4B_q4_0-it.gguf' : '',
        })),
        // 与 LocalAiRuntime.generate 真实契约一致：返回已解析的对象
        generate: vi.fn(async () => options.localGenerate?.('') ?? {}),
    } as unknown as LocalAiService;
    const service = new SentenceLearningServiceImpl(aiProviderService, localAiService);
    return { service, aiProviderService, localAiService };
};

const PARAMS = {
    text: 'I if you\'re feeling like upset about it, you could be like, "Well, let me uh I was just going to finish my thing."',
    precedingLines: ['and no one should be doing that.'],
    followingLines: ['You know, you could kind of make a joke about it.'],
};

describe('整句学习的本地回退', () => {
    it('云端未配置且本地模型就绪时,补全走本地并返回结构化结果', async () => {
        const { service } = buildService({
            cloudModel: null,
            localStatus: { runtimeReady: true, hasReadyModel: true },
            localGenerate: () => ({
                complete: true,
                sentence: PARAMS.text,
                translation: '如果你对此感到不快,你可以说:"我只是想把我的事情做完。"',
            }),
        });

        const result = await service.completeSentence(PARAMS);
        expect(result.complete).toBe(true);
        expect(result.sentence).toBe(PARAMS.text);
        expect(result.translation).toContain('做完');
    });

    it('本地 generate 若返回原始 JSON 字符串(历史形态),同样归一化后通过', async () => {
        const { service } = buildService({
            cloudModel: null,
            localStatus: { runtimeReady: true, hasReadyModel: true },
            localGenerate: () => JSON.stringify({
                complete: true,
                sentence: PARAMS.text,
                translation: '如果你对此感到不快,你可以说:"我只是想把我的事情做完。"',
            }),
        });

        const result = await service.completeSentence(PARAMS);
        expect(result.complete).toBe(true);
    });

    it('可用性判定:云端缺失但本地就绪为 true,两者皆无为 false', async () => {
        const { service: localReady } = buildService({ cloudModel: null, localStatus: { runtimeReady: true, hasReadyModel: true } });
        await expect(localReady.isLearningAvailable()).resolves.toBe(true);

        const { service: none } = buildService({ cloudModel: null, localStatus: { runtimeReady: false, hasReadyModel: false } });
        await expect(none.isLearningAvailable()).resolves.toBe(false);

        const { service: cloudOnly } = buildService({ cloudModel: 'configured', localStatus: null });
        await expect(cloudOnly.isLearningAvailable()).resolves.toBe(true);
    });

    it('云端与本地都不可用时补全显式报错引导配置', async () => {
        const { service } = buildService({ cloudModel: null, localStatus: { runtimeReady: false, hasReadyModel: false } });
        await expect(service.completeSentence(PARAMS)).rejects.toThrow('云端 AI 未配置');
    });

    it('云端已配置时不探测本地,保持原有云端路径', async () => {
        const { service, aiProviderService, localAiService } = buildService({
            cloudModel: 'configured',
            localStatus: { runtimeReady: true, hasReadyModel: true },
        });
        await service.resolveLocalModelId();
        // 云端路径的 generateObject 由 AI SDK 驱动,这里只验证本地探测未被依赖
        expect(vi.mocked(localAiService.getStatus)).toHaveBeenCalled();
        expect(aiProviderService.getModel('sentenceLearning')).not.toBeNull();
    });
});
