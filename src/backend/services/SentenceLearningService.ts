import { inject, injectable } from 'inversify';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { parseMaybeJson } from '@/common/utils/ai/parseMaybeJson';
import TYPES from '@/backend/ioc/types';
import type AiProviderService from '@/backend/services/AiProviderService';
import type LocalAiService from '@/backend/services/LocalAiService';
import { CLOUD_AI_NOT_CONFIGURED_MESSAGE } from '@/backend/services/AiProviderService';
import type {
    CompleteSentenceParams,
    CompleteSentenceResult,
} from '@/common/types/chat';
import { WithRateLimit } from '@/backend/utils/concurrency/decorators';
import { buildCompleteSentencePrompt } from '@/backend/services/chat/ChatPromptBuilder';

/**
 * 完整句补全的结构化输出契约。
 */
const CompleteSentenceSchema = z.object({
    /** 给定字幕行本身是否已是一个完整句子。 */
    complete: z.boolean(),
    /** 完整句子原文；当前行已完整时与原行保持一致。 */
    sentence: z.string().min(1),
    /** 完整句的中文译文。 */
    translation: z.string().min(1),
});

export default interface SentenceLearningService {
    /**
     * 判断当前字幕行是否被换行截断，并尽力补全为完整句子。
     *
     * 说明：云端模型已配置时走云端；未配置时自动回退本地大模型
     * （本地模型就绪即可用，无需额外设置），两者都不可用才报错。
     * 补全结果作为学习会话的主题原文，让解析与对话都围绕完整句进行。
     */
    completeSentence(params: CompleteSentenceParams): Promise<CompleteSentenceResult>;
    /**
     * 整句讲解当前是否可用：功能已启用，且云端模型或本地模型至少一个就绪。
     *
     * 说明：供学习页决定解析与对话入口是否置灰，避免用户点下去才发现用不了。
     */
    isLearningAvailable(): Promise<boolean>;
    /**
     * 解析本地推理可用的模型 id：llama.cpp 运行时就绪且使用中模型已安装时返回
     * 使用中模型 id，否则 null。供补全与分析的云端缺失回退共用。
     */
    resolveLocalModelId(): Promise<string | null>;
}

/**
 * 整句学习中不依赖会话的单次模型调用：字幕完整句补全与可用性探测。
 */
@injectable()
export class SentenceLearningServiceImpl implements SentenceLearningService {
    private logger = getMainLogger('SentenceLearningService');

    /**
     * 构造整句学习单次推理服务。
     *
     * @param aiProviderService 云端模型提供服务。
     * @param localAiService 本地大模型推理服务。
     */
    constructor(
        @inject(TYPES.AiProviderService) private readonly aiProviderService: AiProviderService,
        @inject(TYPES.LocalAiService) private readonly localAiService: LocalAiService,
    ) {}

    @WithRateLimit('gpt')
    public async completeSentence(params: CompleteSentenceParams): Promise<CompleteSentenceResult> {
        const model = this.aiProviderService.getModel('sentenceLearning');
        if (!model) {
            const localModelId = await this.resolveLocalModelId();
            if (!localModelId) {
                throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
            }
            return this.completeSentenceWithLocal(params, localModelId);
        }
        const startedAt = Date.now();
        this.logger.info('complete sentence start', {
            textLength: params.text.length,
            precedingCount: params.precedingLines.length,
            followingCount: params.followingLines.length,
        });
        try {
            const result = await generateObject({
                model,
                schema: CompleteSentenceSchema,
                prompt: buildCompleteSentencePrompt(params),
            });
            this.logger.info('complete sentence done', {
                durationMs: Date.now() - startedAt,
                complete: result.object.complete,
                sentenceLength: result.object.sentence.length,
            });
            return result.object;
        } catch (error) {
            // 结构化输出解析/校验失败时，NoObjectGeneratedError 携带模型原始返回文本，
            // 记进日志才能区分是模型输出格式问题还是接口问题。
            const noObjectError = error as { name?: string; message?: string; text?: unknown };
            this.logger.error('complete sentence failed', {
                durationMs: Date.now() - startedAt,
                errorName: noObjectError?.name,
                errorMessage: noObjectError?.message,
                rawText: typeof noObjectError?.text === 'string' ? noObjectError.text.slice(0, 500) : undefined,
            });
            throw error;
        }
    }

    /**
     * 本地大模型执行字幕完整句补全：与云端同提示词、同 JSON 契约，
     * 结构化输出经 llama.cpp 的 json_object 约束解码，schema 校验失败显式报错。
     */
    private async completeSentenceWithLocal(
        params: CompleteSentenceParams,
        modelId: string,
    ): Promise<CompleteSentenceResult> {
        const startedAt = Date.now();
        this.logger.info('complete sentence (local) start', { modelId, textLength: params.text.length });
        const output = await this.localAiService.generate(
            buildCompleteSentencePrompt(params),
            z.toJSONSchema(CompleteSentenceSchema),
            modelId,
        );
        const parsed = CompleteSentenceSchema.safeParse(parseMaybeJson(output));
        if (!parsed.success) {
            this.logger.error('complete sentence (local) 结构无效', {
                modelId,
                rawText: JSON.stringify(output)?.slice(0, 500),
                issues: parsed.error.issues,
            });
            throw new Error('本地模型补全输出不符合契约');
        }
        this.logger.info('complete sentence (local) done', {
            durationMs: Date.now() - startedAt,
            complete: parsed.data.complete,
        });
        return parsed.data;
    }

    /** 解析本地推理可用的模型 id；运行时缺失或使用中模型未安装时返回 null。 */
    public async resolveLocalModelId(): Promise<string | null> {
        try {
            const status = await this.localAiService.getStatus();
            if (!status.runtimeReady) return null;
            // 按使用中模型精确判断就绪：任一其他模型就绪不代表激活模型可用，
            // 否则 start() 会在用户真正发起请求时才抛「模型未安装」
            return status.models.find((model) => model.modelId === status.activeModelId)?.ready
                ? status.activeModelId
                : null;
        } catch (error) {
            this.logger.warn('local model resolve failed', { error });
            return null;
        }
    }

    /**
     * 云端已配置即可用；未配置时本地模型就绪同样可用（自动回退，无需额外设置）。
     * 判定与真实调用共用同一解析，避免界面「可用」与调用结果漂移。
     */
    public async isLearningAvailable(): Promise<boolean> {
        try {
            if (this.aiProviderService.getModel('sentenceLearning') !== null) return true;
        } catch {
            // 云端配置失效按未配置处理，继续看本地
        }
        return (await this.resolveLocalModelId()) !== null;
    }
}
