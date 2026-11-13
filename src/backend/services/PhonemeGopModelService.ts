import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import MultiFileModelService from '@/backend/services/models/MultiFileModelService';
import {
    PHONEME_GOP_MODEL_DIRECTORY,
    PHONEME_GOP_MODEL_FILE,
    PHONEME_GOP_MODEL_URLS,
    PHONEME_GOP_VOCAB_FILE,
    PHONEME_GOP_VOCAB_URLS,
} from '@/backend/services/models/phonemeGopModel';

/**
 * 离线音素 GOP 声学模型安装与管理服务（支持断点/进度广播、取消与删除）。
 */
@injectable()
export class PhonemeGopModelServiceImpl extends MultiFileModelService {
    constructor(
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) fileSystemGateway: FileSystemGateway,
    ) {
        super(
            {
                modelDirectoryName: PHONEME_GOP_MODEL_DIRECTORY,
                files: [
                    { fileName: PHONEME_GOP_VOCAB_FILE, urls: PHONEME_GOP_VOCAB_URLS },
                    { fileName: PHONEME_GOP_MODEL_FILE, urls: PHONEME_GOP_MODEL_URLS, reportProgress: true },
                ],
                progressEventName: 'settings/phoneme-gop-model-download-progress',
                modelDisplayName: '音素 GOP 模型',
                primaryDownloadUrls: PHONEME_GOP_MODEL_URLS,
                primaryFileName: PHONEME_GOP_MODEL_FILE,
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }
}
