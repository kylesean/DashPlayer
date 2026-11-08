import { z } from 'zod';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    nonEmptyStringSchema,
    positiveIntSchema,
    youtubeImportSettingSaveSchema,
} from '@/backend/controllers/ipc/routeSchemas';
import type YoutubeImportService from '@/backend/services/YoutubeImportService';
import TYPES from '@/backend/ioc/types';

/**
 * 暴露 YouTube 链接导入相关 IPC：发起导入、取消任务、功能开关设置。
 */
@injectable()
export class YoutubeImportController implements Controller {
    constructor(
        @inject(TYPES.YoutubeImportService) private readonly importService: YoutubeImportService,
    ) {}

    /** 注册导入与设置路由。 */
    public registerRoutes(): void {
        registerRoute('youtube-import/start', (p) => this.importService.start(p.url), {
            schema: z.object({ url: nonEmptyStringSchema }),
        });
        registerRoute('youtube-import/cancel', (p) => this.importService.cancel(p.taskId), {
            schema: z.object({ taskId: positiveIntSchema }),
        });
        registerRoute('youtube-import/setting-detail', () => this.importService.getSettingDetail());
        registerRoute('youtube-import/setting-save', (p) => this.importService.saveSetting(p), {
            schema: youtubeImportSettingSaveSchema,
        });
    }
}
