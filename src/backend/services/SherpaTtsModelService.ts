import { inject, injectable } from 'inversify';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import TYPES from '@/backend/ioc/types';
import ModelArchiveService from '@/backend/services/models/ModelArchiveService';
import {
    SHERPA_TTS_MODEL_ARCHIVE_NAME,
    SHERPA_TTS_MODEL_ARCHIVE_SHA256,
    SHERPA_TTS_MODEL_DIRECTORY,
    SHERPA_TTS_MODEL_DOWNLOAD_URLS,
    SHERPA_TTS_REQUIRED_FILES,
} from '@/backend/services/models/sherpaTtsModel';

/**
 * Sherpa-ONNX Piper 英语 TTS 模型管理。
 *
 * 下载与安装流程由 {@link ModelArchiveService} 统一实现，这里只提供差异配置。
 */
@injectable()
export class SherpaTtsModelServiceImpl extends ModelArchiveService {
    constructor(
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) fileSystemGateway: FileSystemGateway,
    ) {
        super(
            {
                downloadUrls: [...SHERPA_TTS_MODEL_DOWNLOAD_URLS],
                archiveSha256: SHERPA_TTS_MODEL_ARCHIVE_SHA256,
                // 断点续传依赖固定工作目录名，不要随版本改。
                workDirectoryName: '.sherpa-tts-download',
                archiveFileName: SHERPA_TTS_MODEL_ARCHIVE_NAME,
                modelDirectoryName: SHERPA_TTS_MODEL_DIRECTORY,
                requiredFiles: [...SHERPA_TTS_REQUIRED_FILES],
                progressEventName: 'settings/sherpa-tts-model-download-progress',
                cancelledMessage: 'Sherpa TTS 模型下载已取消',
                modelDisplayName: 'Sherpa TTS',
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }
}
