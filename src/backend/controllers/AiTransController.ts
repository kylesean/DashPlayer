// src/backend/controllers/AiTransController.ts

import { z } from 'zod';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema } from '@/backend/controllers/ipc/routeSchemas';

import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types'; // 使用接口定义
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import type Controller from '@/backend/controllers/Controller';
import type TranslateService from '@/backend/services/TranslateService';
import type SubtitleTranslationService from '@/backend/services/subtitle-translation/SubtitleTranslationService';

/**
 * 单词词典查询与字幕翻译调度 IPC 控制器。
 */
@injectable()
export default class AiTransController implements Controller {
    /**
     * 构造翻译控制器。
     *
     * @param translateService 单词词典服务。
     * @param subtitleTranslationService 字幕翻译编排服务。
     */
    constructor(
        @inject(TYPES.TranslateService) private readonly translateService: TranslateService,
        @inject(TYPES.SubtitleTranslationService) private readonly subtitleTranslationService: SubtitleTranslationService,
    ) {}

    /**
     * 单词词典查询：预置词典优先，未命中走 OpenAI 词典模型。
     */
    public async transWord(params: { word: string; forceRefresh?: boolean; requestId?: string; context?: string }): Promise<OpenAIDictionaryResult | null> {
        return this.translateService.transWord(params.word, params.forceRefresh, params.requestId, params.context);
    }

    /**
     * 更新当前字幕播放位置并提交翻译需求。
     *
     * @param params 字幕文件哈希与当前播放索引。
     */
    public async updateSubtitleDemand(params: {
        fileHash: string;
        currentIndex: number;
        demandId: number;
        rendererSessionId: string;
    }): Promise<void> {
        await this.subtitleTranslationService.updateDemand(params);
    }

    /**
     * 释放指定字幕文件的后端翻译会话。
     *
     * @param params 待释放的字幕文件哈希与 renderer 会话标识。
     */
    public async releaseSubtitleSession(params: { fileHash: string; rendererSessionId: string }): Promise<void> {
        this.subtitleTranslationService.releaseSession(params.fileHash, params.rendererSessionId);
    }

    /**
     * 注册IPC路由
     */
    registerRoutes(): void {
        registerRoute('ai-trans/word', (p) => this.transWord(p), {
            schema: z.object({
                word: z.string(),
                forceRefresh: z.boolean().optional(),
                requestId: z.string().optional(),
                context: z.string().optional(),
            }),
        });

        registerRoute('ai-trans/update-subtitle-demand', (p) => this.updateSubtitleDemand(p), {
            schema: z.object({
                fileHash: nonEmptyStringSchema,
                currentIndex: z.number().int().min(0),
                demandId: z.number().int().min(0),
                rendererSessionId: nonEmptyStringSchema,
            }),
        });
        registerRoute('ai-trans/release-subtitle-session', (p) => this.releaseSubtitleSession(p), {
            schema: z.object({
                fileHash: nonEmptyStringSchema,
                rendererSessionId: nonEmptyStringSchema,
            }),
        });
        registerRoute('ai-trans/clear-subtitle-translation-cache', async () => ({
            deleted: await this.subtitleTranslationService.clearTranslationCache(),
        }));
        registerRoute('ai-trans/clear-dictionary-cache', async () => ({
            deleted: await this.translateService.clearDictionaryCache(),
        }));
    }
}
