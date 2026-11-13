import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerModelRoutes from '@/backend/controllers/ipc/registerModelRoutes';
import TYPES from '@/backend/ioc/types';
import type LocalModelService from '@/backend/services/models/LocalModelService';

/**
 * 离线音素 GOP 模型管理 IPC 控制器（status / download / cancel-download / delete）。
 */
@injectable()
export default class PhonemeGopModelController implements Controller {
    constructor(
        @inject(TYPES.PhonemeGopModelService) private readonly phonemeGopModelService: LocalModelService,
    ) {}

    registerRoutes(): void {
        registerModelRoutes('phoneme-gop', this.phonemeGopModelService);
    }
}
