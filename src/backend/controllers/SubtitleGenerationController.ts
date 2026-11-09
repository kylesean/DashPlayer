import { z } from 'zod';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { nonEmptyStringSchema, positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import type SubtitleGenerationService from '@/backend/services/SubtitleGenerationService';
import TYPES from '@/backend/ioc/types';

/**
 * 暴露无字幕视频生成字幕的 IPC：启动任务与取消任务。
 */
@injectable()
export default class SubtitleGenerationController implements Controller {
    /**
     * 构造字幕生成控制器。
     *
     * @param subtitleGenerationService 字幕生成业务服务。
     */
    constructor(
        @inject(TYPES.SubtitleGenerationService)
        private readonly subtitleGenerationService: SubtitleGenerationService,
    ) {}

    /**
     * 启动字幕生成任务。
     *
     * @param params.videoId 观看历史记录 ID。
     * @returns 后台任务 ID。
     */
    public async start({ videoId }: { videoId: string }): Promise<number> {
        return this.subtitleGenerationService.start(videoId);
    }

    /**
     * 取消字幕生成任务。
     *
     * @param params.taskId 后台任务 ID。
     */
    public async cancel({ taskId }: { taskId: number }): Promise<void> {
        this.subtitleGenerationService.cancel(taskId);
    }

    /** 注册字幕生成路由。 */
    public registerRoutes(): void {
        registerRoute('subtitle-generation/start', (p) => this.start(p), {
            schema: z.object({ videoId: nonEmptyStringSchema }),
        });
        registerRoute('subtitle-generation/cancel', (p) => this.cancel(p), {
            schema: z.object({ taskId: positiveIntSchema }),
        });
    }
}
