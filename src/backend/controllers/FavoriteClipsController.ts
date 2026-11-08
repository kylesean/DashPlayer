import { z } from 'zod';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    clipQuerySchema,
    nonEmptyStringSchema,
    positiveIntSchema,
} from '@/backend/controllers/ipc/routeSchemas';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type { Tag } from '@/common/contracts/tag';
import type { ClipQuery } from '@/common/api/dto';
import type { FavouriteClipsService } from '@/backend/services/FavouriteClipsService';
import type { ClipMeta, OssBaseMeta } from '@/common/types/clipMeta';
import type SubtitleTranslationService from '@/backend/services/subtitle-translation/SubtitleTranslationService';

/**
 * 收藏片段管理与标签 IPC 控制器。
 */
@injectable()
export default class FavoriteClipsController implements Controller {
    /**
     * 构造收藏片段控制器。
     *
     * @param favouriteClipsService 收藏片段业务服务。
     * @param subtitleTranslationService 字幕翻译服务。
     */
    constructor(
        @inject(TYPES.FavouriteClips) private readonly favouriteClipsService: FavouriteClipsService,
        @inject(TYPES.SubtitleTranslationService) private readonly subtitleTranslationService: SubtitleTranslationService,
    ) {}

    public async addClip({ videoPath, srtKey, indexInSrt }: {
        videoPath: string,
        srtKey: string,
        indexInSrt: number
    }) {
        return this.favouriteClipsService.addClip(videoPath, srtKey, indexInSrt);
    }

    public async cancelAddClip({ srtKey, indexInSrt }: { srtKey: string, indexInSrt: number }): Promise<void> {
        return this.favouriteClipsService.cancelAddClip(srtKey, indexInSrt);
    }

    public async exists({ srtKey, linesInSrt }: {
        srtKey: string,
        linesInSrt: number[]
    }): Promise<Map<number, boolean>> {
        return this.favouriteClipsService.exists(srtKey, linesInSrt);
    }

    public async search(query?: ClipQuery): Promise<(OssBaseMeta & ClipMeta)[]> {
        return this.favouriteClipsService.search(query);
    }

    public queryClipTags(key: string): Promise<Tag[]> {
        return this.favouriteClipsService.queryClipTags(key);
    }

    public addClipTag({ key, tagId }: { key: string, tagId: number }): Promise<void> {
        return this.favouriteClipsService.addClipTag(key, tagId);
    }

    public deleteClipTag({ key, tagId }: { key: string, tagId: number }): Promise<void> {
        return this.favouriteClipsService.deleteClipTag(key, tagId);
    }

    public async taskInfo(): Promise<number> {
        return this.favouriteClipsService.taskInfo();
    }

    public async delete(key: string): Promise<void> {
        return this.favouriteClipsService.deleteFavoriteClip(key);
    }

    /**
     * 使用当前字幕翻译配置批量翻译收藏片段文本。
     *
     * @param sentences 收藏片段中的待翻译文本。
     * @returns 归一化原文到翻译结果的映射。
     */
    public async translate(sentences: string[]): Promise<Map<string, string>> {
        return this.subtitleTranslationService.translateTexts(sentences);
    }

    /**
     * 从外部媒体库重新回灌收藏片段索引。
     */
    public async syncFromOss(): Promise<void> {
        return this.favouriteClipsService.syncFromOss();
    }

    registerRoutes(): void {
        registerRoute('favorite-clips/add', (p) => this.addClip(p), {
            schema: z.object({
                videoPath: nonEmptyStringSchema,
                srtKey: nonEmptyStringSchema,
                indexInSrt: z.number().int().min(0),
            }),
        });
        registerRoute('favorite-clips/cancel-add', (p) => this.cancelAddClip(p), {
            schema: z.object({
                srtKey: nonEmptyStringSchema,
                indexInSrt: z.number().int().min(0),
            }),
        });
        registerRoute('favorite-clips/exists', (p) => this.exists(p), {
            schema: z.object({
                srtKey: nonEmptyStringSchema,
                linesInSrt: z.array(z.number().int().min(0)),
            }),
        });
        registerRoute('favorite-clips/search', (p) => this.search(p), {
            schema: clipQuerySchema,
        });
        registerRoute('favorite-clips/query-clip-tags', (p) => this.queryClipTags(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('favorite-clips/add-clip-tag', (p) => this.addClipTag(p), {
            schema: z.object({
                key: nonEmptyStringSchema,
                tagId: positiveIntSchema,
            }),
        });
        registerRoute('favorite-clips/delete-clip-tag', (p) => this.deleteClipTag(p), {
            schema: z.object({
                key: nonEmptyStringSchema,
                tagId: positiveIntSchema,
            }),
        });
        registerRoute('favorite-clips/task-info', () => this.taskInfo());
        registerRoute('favorite-clips/delete', (p) => this.delete(p), {
            schema: nonEmptyStringSchema,
        });
        registerRoute('favorite-clips/translate', (p) => this.translate(p), {
            schema: z.array(z.string()),
        });
        registerRoute('favorite-clips/sync-from-oss', () => this.syncFromOss());
    }

}
