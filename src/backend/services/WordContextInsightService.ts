import { generateObject, type LanguageModel } from 'ai';
import { inject, injectable } from 'inversify';
import { z } from 'zod';

import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import { ObjUtil } from '@/backend/utils/ObjUtil';
import type AiProviderService from '@/backend/services/AiProviderService';
import type CacheService from '@/backend/services/CacheService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type SettingService from '@/backend/services/SettingService';
import { parseMaybeJson } from '@/common/utils/ai/parseMaybeJson';
import type {
    WordContextInsight,
    WordContextInsightParams,
    WordContextInsightResponse,
} from '@/common/types/wordInsight';

/** 提示词或输出契约变化时递增，使旧缓存自然失效。 */
const PROMPT_VERSION = 'word-context-insight-v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOUD_TIMEOUT_MS = 20_000;
const LOCAL_TIMEOUT_MS = 60_000;
const MAX_WORD_CHARS = 80;
const MAX_SENTENCE_CHARS = 2_000;
const MAX_DEFINITIONS = 8;
const MAX_DEFINITION_CHARS = 300;
const MAX_MEANING_CHARS = 120;
const MAX_NUANCE_CHARS = 240;

/**
 * 语境解读的结构化输出契约。
 *
 * `nuance` 允许省略：小模型在「没有额外差异可讲」时经常直接不输出该字段，
 * 不能因此丢掉仍然有效的 `meaning`。
 */
export const wordContextInsightSchema = z.object({
    meaning: z.string().min(1).max(MAX_MEANING_CHARS),
    nuance: z.string().max(MAX_NUANCE_CHARS).optional(),
});

/**
 * 词卡语境解读服务契约。
 */
export default interface WordContextInsightService {
    /**
     * 结合当前字幕句解释单词在该句中的具体含义与用法。
     *
     * 只在用户主动请求时调用；不进入字幕加载、标注或推荐主路径。
     *
     * @param params 单词、字幕句与当前词卡释义。
     * @returns 解读结果，或 AI 不可用的明确原因。
     */
    explain(params: WordContextInsightParams): Promise<WordContextInsightResponse>;
}

/**
 * 词卡语境解读实现。
 *
 * 可用性遵循词典引擎设置：openai 引擎优先云端，失败后回退本地就绪模型；
 * local 引擎只使用本地模型。两条链路共享同一提示词与输出契约。
 */
@injectable()
export class WordContextInsightServiceImpl implements WordContextInsightService {
    private readonly logger = getMainLogger('WordContextInsightService');
    /** 同一语境、同一模型的并发请求合并为一个，避免连点触发重复推理。 */
    private readonly inFlight = new Map<string, Promise<WordContextInsightResponse>>();

    constructor(
        @inject(TYPES.SettingService) private readonly settingService: SettingService,
        @inject(TYPES.AiProviderService) private readonly aiProviderService: AiProviderService,
        @inject(TYPES.LocalAiService) private readonly localAiService: LocalAiService,
        @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    ) {}

    public async explain(params: WordContextInsightParams): Promise<WordContextInsightResponse> {
        const word = params.word?.trim() ?? '';
        const sentence = params.sentence?.trim().slice(0, MAX_SENTENCE_CHARS) ?? '';
        if (!word) {
            throw new Error('单词不能为空');
        }
        if (word.length > MAX_WORD_CHARS) {
            throw new Error('单词过长');
        }
        if (!sentence) {
            throw new Error('句子不能为空');
        }

        const provider = await this.settingService.getCurrentDictionaryProvider();
        if (!provider) {
            return { status: 'unavailable', reason: 'ai-disabled' };
        }

        const cloudModel = provider === 'openai' ? this.resolveCloudModel() : null;
        // 本地状态查询不加载模型；提前解析让缓存键同时覆盖云端与降级模型。
        const localModelId = await this.resolveLocalModelId();
        if (!cloudModel && !localModelId) {
            return { status: 'unavailable', reason: 'model-unavailable' };
        }

        const definitions = this.normalizeDefinitions(params.definitions);
        const cacheKey = this.buildCacheKey({
            word,
            sentence,
            definitions,
            provider,
            cloudModelId: this.modelIdOf(cloudModel),
            localModelId: localModelId ?? '',
        });

        if (!params.forceRefresh) {
            const cached = this.cacheService.get('cache:word-insight', cacheKey);
            if (cached) {
                return { status: 'ok', insight: { ...cached, cached: true } };
            }
        }

        const existing = this.inFlight.get(cacheKey);
        if (existing) {
            return existing;
        }

        const task = this.generate({
            word,
            sentence,
            definitions,
            cacheKey,
            cloudModel,
            localModelId,
        }).finally(() => {
            this.inFlight.delete(cacheKey);
        });
        this.inFlight.set(cacheKey, task);
        return task;
    }

    /**
     * 依次尝试云端与本地模型，成功一个即返回并写缓存。
     */
    private async generate(args: {
        word: string;
        sentence: string;
        definitions: string[];
        cacheKey: string;
        cloudModel: ReturnType<AiProviderService['getModel']>;
        localModelId: string | null;
    }): Promise<WordContextInsightResponse> {
        const prompt = buildWordContextInsightPrompt(args.word, args.sentence, args.definitions);
        const failures: string[] = [];

        if (args.cloudModel) {
            const startedAt = Date.now();
            try {
                const result = await generateObject({
                    model: args.cloudModel,
                    schema: wordContextInsightSchema,
                    prompt,
                    maxRetries: 0,
                    abortSignal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
                });
                const insight = this.normalizeInsight(result.object, 'cloud');
                this.cacheService.set('cache:word-insight', args.cacheKey, insight, CACHE_TTL_MS);
                this.logger.info('word context insight ready', {
                    word: args.word,
                    source: 'cloud',
                    durationMs: Date.now() - startedAt,
                });
                return { status: 'ok', insight };
            } catch (error) {
                const message = this.errorMessage(error);
                failures.push(`cloud: ${message}`);
                this.logger.warn('word context insight cloud failed, trying local fallback', {
                    word: args.word,
                    durationMs: Date.now() - startedAt,
                    error: message,
                });
            }
        }

        if (args.localModelId) {
            const startedAt = Date.now();
            try {
                const output = await this.localAiService.generate(
                    prompt,
                    z.toJSONSchema(wordContextInsightSchema),
                    args.localModelId,
                    AbortSignal.timeout(LOCAL_TIMEOUT_MS),
                );
                const parsed = wordContextInsightSchema.safeParse(parseMaybeJson(output));
                if (!parsed.success) {
                    this.logger.error('word context insight local output invalid', {
                        word: args.word,
                        issues: parsed.error.issues,
                        rawText: JSON.stringify(output)?.slice(0, 500),
                    });
                    throw new Error('本地模型语境解读输出不符合契约');
                }
                const insight = this.normalizeInsight(parsed.data, 'local');
                this.cacheService.set('cache:word-insight', args.cacheKey, insight, CACHE_TTL_MS);
                this.logger.info('word context insight ready', {
                    word: args.word,
                    source: 'local',
                    durationMs: Date.now() - startedAt,
                });
                return { status: 'ok', insight };
            } catch (error) {
                failures.push(`local: ${this.errorMessage(error)}`);
                this.logger.error('word context insight local failed', {
                    word: args.word,
                    durationMs: Date.now() - startedAt,
                    error: this.errorMessage(error),
                });
            }
        }

        throw new Error(`语境解读生成失败：${failures.join('; ') || '没有可用模型'}`);
    }

    /**
     * 读取语言模型的稳定标识；字符串形式的模型 id 原样返回。
     */
    private modelIdOf(model: LanguageModel | null): string {
        if (!model) return '';
        return typeof model === 'string' ? model : model.modelId;
    }

    /**
     * 读取云端词典模型；配置损坏按不可用处理，由本地模型或明确提示兜底。
     */
    private resolveCloudModel(): ReturnType<AiProviderService['getModel']> {
        try {
            return this.aiProviderService.getModel('dictionary');
        } catch (error) {
            this.logger.warn('word context insight cloud model unavailable', {
                error: this.errorMessage(error),
            });
            return null;
        }
    }

    /**
     * 解析本地推理可用的模型 id；运行时缺失或使用中模型未安装时返回 null。
     */
    private async resolveLocalModelId(): Promise<string | null> {
        try {
            const status = await this.localAiService.getStatus();
            if (!status.runtimeReady) return null;
            return status.models.find((model) => model.modelId === status.activeModelId)?.ready
                ? status.activeModelId
                : null;
        } catch (error) {
            this.logger.warn('word context insight local model resolve failed', {
                error: this.errorMessage(error),
            });
            return null;
        }
    }

    /**
     * 归一化词卡释义，限制数量与单条长度，避免提示词被长文本撑爆。
     */
    private normalizeDefinitions(definitions?: string[]): string[] {
        if (!Array.isArray(definitions)) {
            return [];
        }
        const seen = new Set<string>();
        const normalized: string[] = [];
        for (const definition of definitions) {
            const text = typeof definition === 'string'
                ? definition.trim().slice(0, MAX_DEFINITION_CHARS)
                : '';
            if (!text || seen.has(text)) {
                continue;
            }
            seen.add(text);
            normalized.push(text);
            if (normalized.length >= MAX_DEFINITIONS) {
                break;
            }
        }
        return normalized;
    }

    /**
     * 生成可解释的缓存键：词、句、释义、引擎与两端模型任一变化都会重新生成。
     */
    private buildCacheKey(args: {
        word: string;
        sentence: string;
        definitions: string[];
        provider: 'openai' | 'local';
        cloudModelId: string;
        localModelId: string;
    }): string {
        return ObjUtil.hash({
            mode: 'word-context-insight',
            version: PROMPT_VERSION,
            word: args.word.toLowerCase(),
            sentence: ObjUtil.hash(args.sentence),
            definitions: ObjUtil.hash(args.definitions),
            provider: args.provider,
            cloudModelId: args.cloudModelId,
            localModelId: args.localModelId,
        });
    }

    /**
     * 校验并归一化模型输出，去掉模型爱加的首尾引号。
     */
    private normalizeInsight(
        raw: z.infer<typeof wordContextInsightSchema>,
        source: WordContextInsight['source'],
    ): WordContextInsight {
        const meaning = raw.meaning
            .trim()
            .replace(/^["'“”‘’]+/u, '')
            .replace(/["'“”‘’]+$/u, '')
            .trim()
            .slice(0, MAX_MEANING_CHARS);
        if (!meaning) {
            throw new Error('模型未返回有效的语境含义');
        }
        return {
            meaning,
            nuance: (raw.nuance ?? '').trim().slice(0, MAX_NUANCE_CHARS),
            source,
            cached: false,
        };
    }

    /**
     * 提取可写入日志的错误信息，避免把完整异常对象带进日志字段。
     */
    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * 构建词卡语境解读提示词。
 *
 * 释义仅作为 grounding，不作为必须复述的内容；输出限制为两个短字段，
 * 避免词卡被大段讲解撑满。
 *
 * @param word 单词原文。
 * @param sentence 单词所在字幕句。
 * @param definitions 当前词卡释义。
 * @returns 完整提示词。
 */
export const buildWordContextInsightPrompt = (
    word: string,
    sentence: string,
    definitions: string[],
): string => {
    const definitionBlock = definitions.length > 0
        ? [
            'The learner already sees this dictionary card:',
            ...definitions.map((definition) => `- ${definition}`),
            '',
        ]
        : [];
    return [
        'You are an English-Chinese tutor helping a learner understand one word in a video subtitle.',
        `Word: "${word}"`,
        `Sentence: "${sentence}"`,
        '',
        ...definitionBlock,
        'Explain what the word means IN THIS SENTENCE. Ground every statement in the sentence and the dictionary card; never invent a new sense.',
        '',
        'Rules:',
        '1. meaning: the exact Chinese meaning in this sentence, at most 30 Chinese characters. No English, no quotes, no word repetition.',
        '2. nuance: one short Chinese note (at most 60 Chinese characters) about the grammatical role, collocation, tone, or why a more common sense does not apply. Use an empty string when there is nothing worth saying.',
        '3. Do not translate the whole sentence. Do not add examples or grammar lectures.',
        '4. Output valid JSON only, without markdown fences.',
        '',
        'Output template:',
        '{"meaning":"这里的确切含义","nuance":"简短说明或空字符串"}',
    ].join('\n');
};
