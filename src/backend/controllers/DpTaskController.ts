import registerRoute from '@/backend/controllers/ipc/registerRoute';
import { positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import type Controller from '@/backend/controllers/Controller';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type DpTaskService from '@/backend/services/DpTaskService';

/**
 * 后台通用任务查询与取消 IPC 控制器。
 */
@injectable()
export default class DpTaskController implements Controller {
    /**
     * 构造后台任务控制器。
     *
     * @param dpTaskService 后台任务业务服务。
     */
    constructor(
        @inject(TYPES.DpTaskService) private readonly dpTaskService: DpTaskService,
    ) {}

    public async detail(id: number) {
        return this.dpTaskService.detail(id);
    }

    public async cancel(id: number) {
        this.dpTaskService.cancel(id);
    }

    registerRoutes(): void {
        registerRoute('dp-task/detail', (p) => this.detail(p), { schema: positiveIntSchema });
        registerRoute('dp-task/cancel', (p) => this.cancel(p), { schema: positiveIntSchema });
    }

}
