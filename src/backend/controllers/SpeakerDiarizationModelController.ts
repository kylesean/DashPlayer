import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type SpeakerDiarizationModelService from '@/backend/services/SpeakerDiarizationModelService';

/**
 * 暴露说话人分离模型管理 IPC。
 *
 * 两个模型（分割 + 声纹嵌入）作为一个资源包对外，调用方只需一次下载。
 */
@injectable()
export class SpeakerDiarizationModelController implements Controller {
    constructor(
        @inject(TYPES.SpeakerDiarizationModelService)
        private readonly modelService: SpeakerDiarizationModelService,
    ) {}

    /** 注册模型状态、下载、取消下载与删除路由。 */
    public registerRoutes(): void {
        registerRoute('speaker-diarization/models/status', () => this.modelService.getStatus());
        registerRoute('speaker-diarization/models/download', () => this.modelService.download());
        registerRoute('speaker-diarization/models/cancel-download', () => this.modelService.cancelDownload());
        registerRoute('speaker-diarization/models/delete', () => this.modelService.deleteModel());
    }
}
