import { inject, injectable } from 'inversify';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import TYPES from '@/backend/ioc/types';
import ModelArchiveService from '@/backend/services/models/ModelArchiveService';
import {
    WHISPER_CPP_MODEL_ARCHIVE_NAME,
    WHISPER_CPP_MODEL_DIRECTORY,
    WHISPER_CPP_MODEL_DOWNLOAD_URLS,
    WHISPER_CPP_REQUIRED_FILES,
} from '@/backend/services/models/whisperCppModel';

/**
 * whisper.cpp 引擎的 Parakeet v3 GGUF 模型管理。
 *
 * GGUF 是单文件形态（无归档壳），通过 `archiveKind: 'raw'` 复用
 * {@link ModelArchiveService} 的断点续传与原子安装流程。
 */
@injectable()
export class WhisperCppModelServiceImpl extends ModelArchiveService {
    constructor(
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) fileSystemGateway: FileSystemGateway,
    ) {
        super(
            {
                downloadUrls: [...WHISPER_CPP_MODEL_DOWNLOAD_URLS],
                // 断点续传依赖固定工作目录名，不要随版本改。
                workDirectoryName: '.whisper-cpp-download',
                archiveFileName: WHISPER_CPP_MODEL_ARCHIVE_NAME,
                archiveKind: 'raw',
                modelDirectoryName: WHISPER_CPP_MODEL_DIRECTORY,
                requiredFiles: [...WHISPER_CPP_REQUIRED_FILES],
                progressEventName: 'settings/whisper-cpp-model-download-progress',
                cancelledMessage: 'whisper.cpp 模型下载已取消',
                modelDisplayName: 'whisper.cpp',
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }
}
