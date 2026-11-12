import { inject, injectable } from 'inversify';
import * as path from 'path';
import { z } from 'zod';
import type Controller from '@/backend/controllers/Controller';
import registerModelRoutes from '@/backend/controllers/ipc/registerModelRoutes';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type LocalModelService from '@/backend/services/models/LocalModelService';
import type SettingService from '@/backend/services/SettingService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import {
    SHERPA_TTS_VOICES,
    getSherpaTtsRequiredFiles,
    resolveSherpaTtsVoice,
} from '@/backend/services/models/sherpaTtsModel';
import type { TtsVoiceListVO } from '@/common/contracts/tts-voice';

/**
 * 暴露 Sherpa TTS 模型管理 IPC。
 */
@injectable()
export class SherpaTtsModelController implements Controller {
    constructor(
        @inject(TYPES.SherpaTtsModelService) private readonly modelService: LocalModelService,
        @inject(TYPES.SettingService) private readonly settingService: SettingService,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    /** 注册模型状态、下载、取消下载与删除路由。 */
    public registerRoutes(): void {
        registerModelRoutes('sherpa-tts', this.modelService);
        registerRoute('sherpa-tts/voices/list', () => this.listVoices());
        registerRoute('sherpa-tts/voices/select', (params) => this.selectVoice(params.voiceId), {
            schema: z.object({ voiceId: z.string().min(1) }),
        });
    }

    /**
     * 列出全部音色及其安装状态。
     *
     * 安装状态逐音色独立判断：用户装了美音不代表英音就绪，设置页要能分别提示。
     *
     * @returns 当前选择与全部音色。
     */
    private async listVoices(): Promise<TtsVoiceListVO> {
        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        const voices = await Promise.all(SHERPA_TTS_VOICES.map(async (voice) => {
            const modelDir = path.join(modelsRoot, voice.directoryName);
            // 必需条目里 `espeak-ng-data` 是目录，fileExists 对目录会抛错，
            // 必须用 pathIsMissing 统一判断路径是否存在。
            const required = getSherpaTtsRequiredFiles(voice);
            const missing = await Promise.all(required.map((name) => this.fileSystemGateway.pathIsMissing(path.join(modelDir, name))));
            return {
                id: voice.id,
                name: voice.displayName,
                accent: voice.accent,
                gender: voice.gender,
                quality: voice.quality,
                installed: missing.every((isMissing) => !isMissing),
            };
        }));
        return {
            selected: resolveSherpaTtsVoice(this.settingService.getSherpaTtsVoice()).id,
            voices,
        };
    }

    /**
     * 切换朗读音色。
     *
     * 只落盘选择，不触发下载：下载由用户在看到「未安装」提示后主动点击，
     * 避免切个下拉框就偷偷拉几十兆。
     *
     * @param voiceId 目标音色 id。
     * @returns 切换结果。
     */
    private async selectVoice(voiceId: string): Promise<{ success: boolean; message: string }> {
        await this.settingService.saveSherpaTtsVoice(voiceId);
        return { success: true, message: '' };
    }
}
