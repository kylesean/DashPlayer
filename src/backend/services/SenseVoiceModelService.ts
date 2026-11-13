import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import MultiFileModelService from '@/backend/services/models/MultiFileModelService';
import {
    SENSE_VOICE_MODEL_DIRECTORY,
    SENSE_VOICE_MODEL_FILE,
    SENSE_VOICE_MODEL_URLS,
    SENSE_VOICE_TOKENS_FILE,
    SENSE_VOICE_TOKENS_URLS,
} from '@/backend/services/models/senseVoiceModel';

/**
 * 离线多语种对话语音识别（SenseVoiceSmall INT8）模型安装与管理服务。
 */
@injectable()
export class SenseVoiceModelServiceImpl extends MultiFileModelService {
    constructor(
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) fileSystemGateway: FileSystemGateway,
    ) {
        super(
            {
                modelDirectoryName: SENSE_VOICE_MODEL_DIRECTORY,
                files: [
                    { fileName: SENSE_VOICE_TOKENS_FILE, urls: SENSE_VOICE_TOKENS_URLS },
                    { fileName: SENSE_VOICE_MODEL_FILE, urls: SENSE_VOICE_MODEL_URLS, reportProgress: true },
                ],
                progressEventName: 'settings/sense-voice-model-download-progress',
                modelDisplayName: 'SenseVoice 中英双语语音模型',
                primaryDownloadUrls: SENSE_VOICE_MODEL_URLS,
                primaryFileName: SENSE_VOICE_MODEL_FILE,
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }
}
