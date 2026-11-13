import { z } from 'zod';
import type Controller from '@/backend/controllers/Controller';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type VocabularyService from '@/backend/services/VocabularyService';
import {
    type GetAllWordsParams,
    type UpdateWordParams,
    type UpdateWordStateParams,
} from '@/backend/services/VocabularyService';
import type SentenceVocabularyService from '@/backend/services/SentenceVocabularyService';
import type ContextPackService from '@/backend/services/ContextPackService';
import type WordEncounterService from '@/backend/services/WordEncounterService';
import type { SentenceVocabularyVO } from '@/common/types/vo/SentenceVocabularyVO';
import type { ContextPackParams } from '@/common/types/contextPack';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema, positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import {
    WORD_ENCOUNTER_ACTIONS,
    VOCABULARY_GUIDANCE_LEVELS,
    WORD_STATUSES,
    type WordEncounterInput,
} from '@/common/types/vocabulary';
import { REVIEW_RATINGS, type ReviewRateParams } from '@/common/types/review';

/**
 * 生词本管理与句子生词筛选 IPC 控制器。
 */
@injectable()
export default class VocabularyController implements Controller {
    /**
     * 构造生词控制器。
     *
     * @param vocabularyService 生词本业务服务。
     * @param sentenceVocabularyService 句子生词筛选服务。
     * @param contextPackService 上下文建议服务。
     * @param wordEncounterService 单词遭遇事件服务。
     */
    constructor(
        @inject(TYPES.VocabularyService) private readonly vocabularyService: VocabularyService,
        @inject(TYPES.SentenceVocabularyService) private readonly sentenceVocabularyService: SentenceVocabularyService,
        @inject(TYPES.ContextPackService) private readonly contextPackService: ContextPackService,
        @inject(TYPES.WordEncounterService) private readonly wordEncounterService: WordEncounterService,
    ) {}

    public async getAllWords(params: GetAllWordsParams = {}) {
        return this.vocabularyService.getAllWords(params);
    }

    public async exportTemplate() {
        return this.vocabularyService.exportTemplate();
    }

    public async importWords(params: { filePath: string }) {
        return this.vocabularyService.importWords(params.filePath);
    }

    public async favoriteWord(params: { word: string; translate?: string }) {
        return this.vocabularyService.favoriteWord(params.word, params.translate);
    }

    public async updateWord(params: UpdateWordParams) {
        return this.vocabularyService.updateWord(params);
    }

    public async updateWordState(params: UpdateWordStateParams) {
        return this.vocabularyService.updateWordState(params);
    }

    /**
     * 读取一个词的学习历史快照。
     *
     * 纯只读，供词卡展示「上次遇见 / 上次复习 / 当前状态」。
     *
     * @param params 用户点击的词形。
     * @returns 历史快照；不可用时为 null。
     */
    public async getWordMemory(params: { word: string }) {
        return this.vocabularyService.getWordMemory(params.word);
    }

    public async recordWordEncounter(params: WordEncounterInput): Promise<void> {
        await this.wordEncounterService.record(params);
    }

    public async getReviewQueue(params: { limit?: number; words?: string[] } = {}) {
        return this.wordEncounterService.getReviewQueue(params.limit, params.words);
    }

    public async rateReview(params: ReviewRateParams) {
        return this.wordEncounterService.rateReview(params);
    }

    public async deleteWord(params: { word: string }) {
        return this.vocabularyService.deleteWord(params.word);
    }

    public async generateDefinition(params: { word: string }) {
        return this.vocabularyService.generateDefinition(params.word);
    }

    /**
     * 选出一个句子里值得重点认识的生词，并返回句内逐词释义。
     *
     * 说明：全程只读本地词典，不调用模型、不访问网络。
     *
     * @param params.text 目标句子原文。
     * @returns 生词列表与句内逐词释义映射。
     */
    public async pickSentenceVocabulary(params: { text: string }): Promise<SentenceVocabularyVO> {
        return this.sentenceVocabularyService.pick(params.text);
    }

    /**
     * 生成一句话的上下文建议。
     *
     * @param params 句子、播放定位与提示强度。
     * @returns 候选评分与唯一建议。
     */
    public async buildContextPack(params: ContextPackParams) {
        return this.contextPackService.build(params);
    }

    registerRoutes(): void {
        registerRoute('vocabulary/get-all', (p) => this.getAllWords(p), {
            schema: z.object({
                search: z.string().optional(),
                page: positiveIntSchema.optional(),
                pageSize: positiveIntSchema.optional(),
            }),
        });
        registerRoute('vocabulary/export-template', () => this.exportTemplate());
        registerRoute('vocabulary/import', (p) => this.importWords(p), {
            schema: z.object({ filePath: nonEmptyStringSchema }),
        });
        registerRoute('vocabulary/favorite', (p) => this.favoriteWord(p), {
            schema: z.object({
                word: nonEmptyStringSchema,
                translate: z.string().optional(),
            }),
        });
        registerRoute('vocabulary/update', (p) => this.updateWord(p), {
            schema: z.object({
                oldWord: nonEmptyStringSchema,
                word: nonEmptyStringSchema,
                translate: z.string(),
            }),
        });
        registerRoute('vocabulary/update-state', (p) => this.updateWordState(p), {
            schema: z.object({
                word: nonEmptyStringSchema,
                status: z.enum(WORD_STATUSES),
            }),
        });
        registerRoute('vocabulary/word-memory', (p) => this.getWordMemory(p), {
            schema: z.object({ word: nonEmptyStringSchema }),
        });
        registerRoute('vocabulary/record-encounter', (p) => this.recordWordEncounter(p), {
            schema: z.object({
                word: nonEmptyStringSchema,
                action: z.enum(WORD_ENCOUNTER_ACTIONS),
                videoId: z.string().optional(),
                fileHash: z.string().optional(),
                sentenceIndex: z.number().int().nonnegative().optional(),
                sentenceHash: z.string().optional(),
                context: z.string().optional(),
                score: z.number().min(0).max(100).optional(),
                rating: z.enum(REVIEW_RATINGS).optional(),
            }),
        });
        registerRoute('vocabulary/review-queue', (p) => this.getReviewQueue(p), {
            schema: z.object({
                limit: z.number().int().positive().max(50).optional(),
                words: z.array(z.string().min(1)).max(50).optional(),
            }),
        });
        registerRoute('vocabulary/rate-review', (p) => this.rateReview(p), {
            schema: z.object({
                word: nonEmptyStringSchema,
                rating: z.enum(REVIEW_RATINGS),
                videoId: z.string().min(1).optional(),
                fileHash: z.string().min(1).optional(),
            }),
        });
        registerRoute('vocabulary/delete', (p) => this.deleteWord(p), {
            schema: z.object({ word: nonEmptyStringSchema }),
        });
        registerRoute('vocabulary/generate-definition', (p) => this.generateDefinition(p), {
            schema: z.object({ word: nonEmptyStringSchema }),
        });
        registerRoute('vocabulary/pick-sentence', (p) => this.pickSentenceVocabulary(p), {
            schema: z.object({ text: z.string() }),
        });
        registerRoute('vocabulary/context-pack', (p) => this.buildContextPack(p), {
            schema: z.object({
                text: z.string().min(1).max(2000),
                fileHash: z.string().min(1).optional(),
                sentenceIndex: z.number().int().nonnegative().optional(),
                guidance: z.enum(VOCABULARY_GUIDANCE_LEVELS),
            }),
        });
    }
}
