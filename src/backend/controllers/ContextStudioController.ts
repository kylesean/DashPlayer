import { z } from 'zod';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema } from '@/backend/controllers/ipc/routeSchemas';
import TYPES from '@/backend/ioc/types';
import type ContextStudioService from '@/backend/services/ContextStudioService';
const savedSentenceTagSchema = z.enum(['expression', 'pronunciation', 'grammar', 'general']);

/**
 * 语境工坊与精读文稿 IPC 控制器。
 */
@injectable()
export default class ContextStudioController implements Controller {
    constructor(
        @inject(TYPES.ContextStudioService) private readonly contextStudioService: ContextStudioService,
    ) {}

    public registerRoutes(): void {
        registerRoute('context-studio/save-sentence', (params) => this.contextStudioService.saveSentence(params), {
            schema: z.object({
                sentenceKey: nonEmptyStringSchema,
                videoId: z.string(),
                videoTitle: z.string().optional(),
                fileHash: nonEmptyStringSchema,
                sentenceIndex: z.number().int().min(0),
                startTime: z.number().min(0),
                endTime: z.number().min(0),
                text: nonEmptyStringSchema,
                textZh: z.string().optional(),
                note: z.string().optional(),
                tag: savedSentenceTagSchema.optional(),
            }),
        });

        registerRoute('context-studio/unsave-sentence', (params) => this.contextStudioService.unsaveSentence(params.sentenceKey), {
            schema: z.object({
                sentenceKey: nonEmptyStringSchema,
            }),
        });

        registerRoute('context-studio/list-saved-sentences', () => this.contextStudioService.listSavedSentences());

        registerRoute('context-studio/list-saved-keys', (params) => this.contextStudioService.listSavedKeysByVideo(params.videoId), {
            schema: z.object({
                videoId: z.string(),
            }),
        });

        registerRoute('context-studio/update-saved-sentence', (params) => this.contextStudioService.updateSavedSentence(params), {
            schema: z.object({
                sentenceKey: nonEmptyStringSchema,
                note: z.string().optional(),
                tag: savedSentenceTagSchema.optional(),
            }),
        });

        registerRoute('context-studio/get-word-contexts', (params) => this.contextStudioService.getWordContexts(params.word), {
            schema: z.object({
                word: nonEmptyStringSchema,
            }),
        });

        registerRoute('context-studio/list-reader-documents', () => this.contextStudioService.listReaderDocuments());
    }
}
