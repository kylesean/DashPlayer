import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerModelRoutes from '@/backend/controllers/ipc/registerModelRoutes';
import TYPES from '@/backend/ioc/types';
import type LocalModelService from '@/backend/services/models/LocalModelService';

/**
 * 暴露 Sherpa TTS 模型管理 IPC。
 */
@injectable()
export class SherpaTtsModelController implements Controller {
    constructor(@inject(TYPES.SherpaTtsModelService) private readonly modelService: LocalModelService) {}

    /** 注册模型状态、下载、取消下载与删除路由。 */
    public registerRoutes(): void {
        registerModelRoutes('sherpa-tts', this.modelService);
    }
}
