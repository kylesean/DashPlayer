import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-subtitle-retry-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import LocalSubtitleBatchTranslatorImpl from '@/backend/infrastructure/translate/LocalSubtitleBatchTranslatorImpl';
import type LocalAiService from '@/backend/services/LocalAiService';
import type {
    LocalSubtitleBatchTranslationInput,
    SubtitleTranslationTarget,
} from '@/backend/services/gateways/translate/SubtitleBatchTranslationInput';

const TARGETS: SubtitleTranslationTarget[] = [
    { key: 'k1', text: 'They are going to say things that hurt your feelings.' },
    { key: 'k2', text: 'You can say, "No, thanks."' },
];

/** 构造最小可用的批次输入(mode=en 绕开 zh 照抄检测,聚焦重试行为)。 */
const buildInput = (): LocalSubtitleBatchTranslationInput => ({
    targets: TARGETS,
    contextBefore: [],
    contextAfter: [],
    mode: 'simple_en',
    style: 'concise',
    signal: new AbortController().signal,
    modelId: 'custom:gemma-4-E4B_q4_0-it.gguf',
});

/** 拼一条符合填槽输出形状的模型回复。 */
const fill = (translations: string[]): string =>
    JSON.stringify({ items: TARGETS.map((t, i) => ({ source: t.text, translation: translations[i] ?? '' })) });

/** 构造注入桩的翻译器:generateText 按脚本依次返回,记录每次采样温度。 */
const buildTranslator = (script: string[]) => {
    const temperatures: Array<number | undefined> = [];
    const localAi = {
        generateText: vi.fn(async (_prompt: string, _modelId: string, _signal: AbortSignal, options?: { temperature?: number }) => {
            temperatures.push(options?.temperature);
            const step = script[Math.min(temperatures.length - 1, script.length - 1)];
            return step;
        }),
    } as unknown as LocalAiService;
    return { translator: new LocalSubtitleBatchTranslatorImpl(localAi), temperatures };
};

describe('LocalSubtitleBatchTranslator 批次失败升温重试', () => {
    it('槽内退化触顶后自动升温重试一次并成功返回', async () => {
        const { translator, temperatures } = buildTranslator([
            // 首跑:第 2 槽译文重复堆词触顶(limit 按源文长度推导,99 字符起步)
            fill(['第一条', '啊'.repeat(120)]),
            // 升温重跑:正常译文
            fill(['first', 'second']),
        ]);

        const result = await translator.translate(buildInput());
        expect(result.map((item) => item.translation)).toEqual(['first', 'second']);
        expect(temperatures).toEqual([0, 0.3]);
    });

    it('首跑即成功时不做额外重试,温度保持 0', async () => {
        const { translator, temperatures } = buildTranslator([
            fill(['first', 'second']),
        ]);

        const result = await translator.translate(buildInput());
        expect(result.map((item) => item.translation)).toEqual(['first', 'second']);
        expect(temperatures).toEqual([0]);
    });

    it('升温重试仍失败时抛出后一次的解析错误', async () => {
        const { translator, temperatures } = buildTranslator([
            fill(['第一条', '啊'.repeat(120)]),
            fill(['第一条', '啊'.repeat(120)]),
        ]);

        await expect(translator.translate(buildInput())).rejects.toThrow('触顶');
        expect(temperatures).toEqual([0, 0.3]);
    });
});
