import { inject, injectable } from 'inversify';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import TYPES from '@/backend/ioc/types';
import ModelArchiveService from '@/backend/services/models/ModelArchiveService';
import {
    PARAKEET_MODEL_ARCHIVE_NAME,
    PARAKEET_MODEL_ARCHIVE_SHA256,
    PARAKEET_MODEL_DIRECTORY,
    PARAKEET_MODEL_DOWNLOAD_URLS,
    PARAKEET_REQUIRED_FILES,
} from '@/backend/services/models/parakeetModel';

/**
 * Parakeet v3（sherpa-onnx INT8 归档）模型管理。
 *
 * 下载与安装流程由 {@link ModelArchiveService} 统一实现，这里只提供差异配置。
 */
@injectable()
export class ParakeetModelServiceImpl extends ModelArchiveService {
    constructor(
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) fileSystemGateway: FileSystemGateway,
    ) {
        super(
            {
                downloadUrls: [...PARAKEET_MODEL_DOWNLOAD_URLS],
                archiveSha256: PARAKEET_MODEL_ARCHIVE_SHA256,
                // 断点续传依赖固定工作目录名，不要随版本改。
                workDirectoryName: '.parakeet-download',
                archiveFileName: PARAKEET_MODEL_ARCHIVE_NAME,
                modelDirectoryName: PARAKEET_MODEL_DIRECTORY,
                requiredFiles: [...PARAKEET_REQUIRED_FILES],
                progressEventName: 'settings/parakeet-model-download-progress',
                cancelledMessage: 'Parakeet 模型下载已取消',
                modelDisplayName: 'Parakeet v3',
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }
}
