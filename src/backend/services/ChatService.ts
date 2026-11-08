import { inject, injectable } from 'inversify';
import type DpTaskService from '@/backend/services/DpTaskService';
import TYPES from '@/backend/ioc/types';
import { ZodType } from 'zod';
import { Output, streamText } from 'ai';
import type AiProviderService from '@/backend/services/AiProviderService';
import { WithRateLimit } from '@/backend/utils/concurrency/decorators';
import { getMainLogger } from '@/backend/infrastructure/logger';

export default interface ChatService {
    /**
     * 流式产出符合 schema 的结构化对象，并把最终校验结果写入后台任务。
     * @param taskId 任务编号。
     * @param resultSchema 期望的结构化输出 schema。
     * @param promptStr 提示词全文。
     */
    run(taskId: number, resultSchema: ZodType, promptStr: string): Promise<void>;
}


/**
 * 结构化对话任务服务实现。
 */
@injectable()
export class ChatServiceImpl implements ChatService {
    private logger = getMainLogger('ChatService');

    /**
     * 构造结构化对话任务服务。
     *
     * @param dpTaskService 后台任务管理服务。
     * @param aiProviderService AI 模型提供服务。
     */
    constructor(
        @inject(TYPES.DpTaskService) private readonly dpTaskService: DpTaskService,
        @inject(TYPES.AiProviderService) private readonly aiProviderService: AiProviderService,
    ) {}

    @WithRateLimit('gpt')
    public async run(taskId: number, resultSchema: ZodType, promptStr: string) {
        const model = this.aiProviderService.getModel('sentenceLearning');
        if (!model) {
            this.dpTaskService.fail(taskId, {
                progress: 'OpenAI api key or endpoint is empty'
            });
            return;
        }
        this.logger.debug('stream json start', { taskId });
        try {
            const result = streamText({
                model,
                output: Output.object({ schema: resultSchema }),
                prompt: promptStr,
            });
            this.dpTaskService.process(taskId, {
                progress: 'AI is analyzing...'
            });
            for await (const partialObject of result.partialOutputStream) {
                this.logger.debug('stream json chunk', {
                    taskId,
                    keys: Object.keys(partialObject ?? {}),
                });
                // 中间态仅用于任务查看器即时展示；最终以 schema 校验后的完整对象为准。
                this.dpTaskService.process(taskId, {
                    progress: 'AI is analyzing...',
                    result: JSON.stringify(partialObject)
                });
            }
            // partialOutputStream 结束不代表输出合法，必须等 output 的校验结果，
            // 否则残缺对象会被当成最终结果写进任务。
            const finalObject = await result.output;
            this.logger.debug('stream json done', { taskId });
            this.dpTaskService.finish(taskId, {
                progress: 'AI has responded',
                result: JSON.stringify(finalObject)
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('stream json failed', { taskId, error: message });
            this.dpTaskService.fail(taskId, {
                progress: `AI 请求失败：${message}`
            });
        }
    }
}
