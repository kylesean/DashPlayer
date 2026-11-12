import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerModelRoutes from '@/backend/controllers/ipc/registerModelRoutes';
import type LocalModelService from '@/backend/services/models/LocalModelService';
import TYPES from '@/backend/ioc/types';

/**
 * 暴露 whisper.cpp 本地模型管理 IPC。
 */
@injectable()
export default class WhisperCppModelController implements Controller {
    constructor(@inject(TYPES.WhisperCppModelService) private readonly modelService: LocalModelService) {}

    /** 注册模型状态、下载、取消下载与删除路由。 */
    public registerRoutes(): void {
        registerModelRoutes('whisper-cpp', this.modelService);
    }
}
