import { z } from 'zod';
import type { VideoLearningService } from '@/backend/services/VideoLearningService';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    clipContentLinesSchema,
    nonEmptyStringSchema,
    simpleClipQuerySchema,
} from '@/backend/controllers/ipc/routeSchemas';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type Controller from '@/backend/controllers/Controller';

/**
 * 视频词汇学习片段管理 IPC 控制器。
 */
@injectable()
export default class VideoLearningApiController implements Controller {
    /**
     * 构造视频学习控制器。
     *
     * @param videoLearningService 视频学习片段业务服务。
     */
    constructor(
        @inject(TYPES.VideoLearningService) private readonly videoLearningService: VideoLearningService,
    ) {}

    registerRoutes(): void {
        registerRoute('video-learning/detect-clip-status', async (params) => {
            const { videoPath, srtKey, srtPath } = params;
            const result = await this.videoLearningService.detectClipStatus(videoPath, srtKey, srtPath);
            return result;
        }, {
            schema: z.object({
                videoPath: nonEmptyStringSchema,
                srtKey: nonEmptyStringSchema,
                srtPath: z.string().optional(),
            }),
        });

        registerRoute('video-learning/clip-queue-status', async () => {
            const result = await this.videoLearningService.getGlobalClipQueueStatus();
            return result;
        });

        registerRoute('video-learning/auto-clip', async (params) => {
            const { videoPath, srtKey, srtPath } = params;
            await this.videoLearningService.autoClip(videoPath, srtKey, srtPath);
            return { success: true };
        }, {
            schema: z.object({
                videoPath: nonEmptyStringSchema,
                srtKey: nonEmptyStringSchema,
                srtPath: z.string().optional(),
            }),
        });

        registerRoute('video-learning/cancel-auto-clip-all', async () => {
            const clearedCount = await this.videoLearningService.cancelAllAutoClipTasks();
            return { success: true, clearedCount };
        });

        registerRoute('video-learning/delete', async (params) => {
            const { key } = params;
            await this.videoLearningService.deleteLearningClip(key);
            return { success: true };
        }, {
            schema: z.object({ key: nonEmptyStringSchema }),
        });


        registerRoute('video-learning/search', async (params) => {
            const result = await this.videoLearningService.search(params);
            return { success: true, data: result };
        }, {
            schema: simpleClipQuerySchema,
        });

        registerRoute('video-learning/resolve-clip-vocabulary', async (params) => {
            const data = await this.videoLearningService.resolveClipVocabulary(params.lines, params.words);
            return { success: true, data };
        }, {
            schema: z.object({
                lines: clipContentLinesSchema,
                words: z.array(z.string()),
            }),
        });


        registerRoute('video-learning/sync-from-oss', async () => {
            await this.videoLearningService.syncFromOss();
            return { success: true };
        });

        registerRoute('video-learning/word-clip-stats', async () => {
            const data = await this.videoLearningService.getWordClipStats();
            return { success: true, data };
        });
    }
}
