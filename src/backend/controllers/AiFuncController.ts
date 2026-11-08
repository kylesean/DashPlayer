import { z } from 'zod';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { finiteNonNegativeNumberSchema, nonEmptyStringSchema } from '@/backend/controllers/ipc/routeSchemas';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import TYPES from '@/backend/ioc/types';
import type AiFuncService from '@/backend/services/AiFuncService';

/**
 * AI 文本切分、语音合成与本地语音转录 IPC 控制器。
 */
@injectable()
export default class AiFuncController implements Controller {
    /**
     * 构造 AI 功能控制器。
     *
     * @param aiFuncService AI 功能业务服务。
     */
    constructor(
        @inject(TYPES.AiFuncService) private readonly aiFuncService: AiFuncService,
    ) {}


    registerRoutes(): void {
        registerRoute('ai-func/format-split', (p) => this.aiFuncService.formatSplit(p), {
            schema: z.string(),
        });
        registerRoute('ai-func/tts', (p) => this.aiFuncService.tts(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('transcript/list', () => this.aiFuncService.listTranscriptionTasks());
        registerRoute('transcript/enqueue', (p) => this.aiFuncService.enqueueTranscription(p), {
            schema: z.object({ filePath: nonEmptyStringSchema }),
        });
        registerRoute('transcript/remove', (p) => this.aiFuncService.removeTranscription(p), {
            schema: z.object({ filePath: nonEmptyStringSchema }),
        });
        registerRoute('transcript/start', (p) => this.aiFuncService.transcript(p), {
            schema: z.object({
                filePath: nonEmptyStringSchema,
                currentPosition: finiteNonNegativeNumberSchema.optional(),
            }),
        });
        registerRoute('transcript/update-demand', (p) => this.aiFuncService.updateTranscriptionDemand(p), {
            schema: z.object({
                filePath: nonEmptyStringSchema,
                currentPosition: finiteNonNegativeNumberSchema,
            }),
        });
        registerRoute('transcript/session-snapshot', (p) => this.aiFuncService.getTranscriptionSnapshot(p), {
            schema: z.object({ filePath: nonEmptyStringSchema }),
        });
        registerRoute('transcript/cancel', (p) => this.aiFuncService.cancelTranscription(p), {
            schema: z.object({ filePath: nonEmptyStringSchema }),
        });
    }
}
