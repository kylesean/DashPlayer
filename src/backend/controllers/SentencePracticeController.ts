import { z } from 'zod';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    dictationParamsSchema,
    nonEmptyStringSchema,
    shadowingParamsSchema,
} from '@/backend/controllers/ipc/routeSchemas';
import TYPES from '@/backend/ioc/types';
import type SentencePracticeService from '@/backend/services/SentencePracticeService';

/**
 * 句子练习 IPC 控制器:注册 practice/* 路径,参数整理与转发到 SentencePracticeService。
 */
@injectable()
export default class SentencePracticeController implements Controller {
    /**
     * 构造句子练习控制器。
     *
     * @param sentencePracticeService 句子跟读与听写评分服务。
     */
    constructor(
        @inject(TYPES.SentencePracticeService) private readonly sentencePracticeService: SentencePracticeService,
    ) {}

    registerRoutes(): void {
        registerRoute('practice/score-shadowing', (p) => this.sentencePracticeService.scoreShadowing(p), {
            schema: shadowingParamsSchema,
        });
        registerRoute('practice/score-dictation', (p) => this.sentencePracticeService.scoreDictation(p), {
            schema: dictationParamsSchema,
        });
        registerRoute('practice/list-by-sentence', (p) => this.sentencePracticeService.listBySentence(p), {
            schema: z.object({
                fileHash: nonEmptyStringSchema,
                sentenceIndex: z.number().int().min(0),
                resegmented: z.boolean(),
            }),
        });
        registerRoute('practice/list-by-file', (p) => this.sentencePracticeService.listByFile(p), {
            schema: z.object({
                fileHash: nonEmptyStringSchema,
                resegmented: z.boolean(),
            }),
        });
    }
}
