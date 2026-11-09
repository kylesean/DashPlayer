import { z } from 'zod';
import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import type EnglishDictionaryService from '@/backend/services/EnglishDictionaryService';
import TYPES from '@/backend/ioc/types';

/**
 * 英英释义增强包的 IPC：状态、安装、取消、删除。
 */
@injectable()
export default class EnglishDictionaryController implements Controller {
    /**
     * 构造增强包控制器。
     *
     * @param englishDictionaryService 英英释义增强包服务。
     */
    constructor(
        @inject(TYPES.EnglishDictionaryService)
        private readonly englishDictionaryService: EnglishDictionaryService,
    ) {}

    /** 注册增强包路由。 */
    public registerRoutes(): void {
        registerRoute('dictionary-enhancement/status', async () => this.englishDictionaryService.status());
        registerRoute('dictionary-enhancement/install', async () => this.englishDictionaryService.install());
        registerRoute('dictionary-enhancement/cancel', async (p) => {
            this.englishDictionaryService.cancel(p.taskId);
        }, {
            schema: z.object({ taskId: positiveIntSchema }),
        });
        registerRoute('dictionary-enhancement/remove', async () => {
            this.englishDictionaryService.remove();
        });
    }
}
