import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerModelRoutes from '@/backend/controllers/ipc/registerModelRoutes';
import TYPES from '@/backend/ioc/types';
import type LocalModelService from '@/backend/services/models/LocalModelService';

/**
 * 离线 SenseVoice 多语种对话语音模型管理 IPC 控制器（status / download / cancel-download / delete）。
 */
@injectable()
export default class SenseVoiceModelController implements Controller {
    constructor(
        @inject(TYPES.SenseVoiceModelService) private readonly senseVoiceModelService: LocalModelService,
    ) {}

    registerRoutes(): void {
        registerModelRoutes('sense-voice', this.senseVoiceModelService);
    }
}
