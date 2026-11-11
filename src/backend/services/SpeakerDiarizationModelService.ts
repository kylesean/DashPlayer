import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import { ModelArchiveInstaller } from '@/backend/services/models/ModelArchiveInstaller';
import {
    DIARIZATION_EMBEDDING_BYTES,
    DIARIZATION_EMBEDDING_DIRECTORY,
    DIARIZATION_EMBEDDING_DOWNLOAD_URL,
    DIARIZATION_EMBEDDING_FILE,
    DIARIZATION_EMBEDDING_SHA256,
    DIARIZATION_EMBEDDING_WORK_DIRECTORY,
    DIARIZATION_SEGMENTATION_ARCHIVE_NAME,
    DIARIZATION_SEGMENTATION_ARCHIVE_SHA256,
    DIARIZATION_SEGMENTATION_DIRECTORY,
    DIARIZATION_SEGMENTATION_DOWNLOAD_URL,
    DIARIZATION_SEGMENTATION_FILE,
} from '@/backend/services/models/speakerDiarizationModel';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';

/** 下载被取消时抛出的错误信息。 */
const DOWNLOAD_CANCELLED_MESSAGE = '说话人分离模型下载已取消';

/** 两项模型都就绪时的聚合状态。 */
export interface DiarizationModelStatus {
    /** 分割模型是否就绪。 */
    segmentationReady: boolean;
    /** 声纹嵌入模型是否就绪。 */
    embeddingReady: boolean;
    /** 两项都就绪时才可分离。 */
    ready: boolean;
    /** 分割模型下载地址，供设置页展示。 */
    segmentationUrls: string[];
    /** 声纹嵌入模型下载地址。 */
    embeddingUrls: string[];
}

/**
 * 说话人分离模型管理服务契约。
 */
export default interface SpeakerDiarizationModelService {
    /**
     * 查询两个模型的安装状态。
     */
    getStatus(): Promise<DiarizationModelStatus>;

    /**
     * 依次下载两个模型。
     *
     * @returns 下载结果；任一模型失败即中止并返回失败。
     */
    download(): Promise<{ success: boolean; message: string }>;

    /**
     * 取消进行中的下载。
     */
    cancelDownload(): Promise<{ cancelled: boolean }>;

    /**
     * 删除两个模型目录。
     */
    deleteModel(): Promise<{ success: boolean; message: string }>;
}

/**
 * 说话人分离模型管理。
 *
 * 两个模型缺一不可，所以这里把两次独立安装聚合成一个「资源包」对外暴露：
 * 设置页只需一次状态查询、一次下载，不必了解内部分成两个文件。
 */
@injectable()
export class SpeakerDiarizationModelServiceImpl implements SpeakerDiarizationModelService {
    private readonly segmentation: ModelArchiveInstaller;
    private readonly embedding: ModelArchiveInstaller;

    constructor(
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) fileSystemGateway: FileSystemGateway,
    ) {
        this.segmentation = new ModelArchiveInstaller(
            {
                downloadUrls: [DIARIZATION_SEGMENTATION_DOWNLOAD_URL],
                archiveSha256: DIARIZATION_SEGMENTATION_ARCHIVE_SHA256,
                workDirectoryName: '.diarization-segmentation-download',
                archiveFileName: DIARIZATION_SEGMENTATION_ARCHIVE_NAME,
                modelDirectoryName: DIARIZATION_SEGMENTATION_DIRECTORY,
                requiredFiles: [DIARIZATION_SEGMENTATION_FILE],
                progressEventName: 'settings/speaker-diarization-model-download-progress',
                cancelledMessage: DOWNLOAD_CANCELLED_MESSAGE,
                modelDisplayName: '说话人分割模型',
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
        this.embedding = new ModelArchiveInstaller(
            {
                downloadUrls: [DIARIZATION_EMBEDDING_DOWNLOAD_URL],
                archiveSha256: DIARIZATION_EMBEDDING_SHA256,
                workDirectoryName: DIARIZATION_EMBEDDING_WORK_DIRECTORY,
                // raw 形态：下载到的 onnx 就是模型文件本身，无需解压。
                archiveKind: 'raw',
                archiveFileName: DIARIZATION_EMBEDDING_FILE,
                modelDirectoryName: DIARIZATION_EMBEDDING_DIRECTORY,
                requiredFiles: [DIARIZATION_EMBEDDING_FILE],
                progressEventName: 'settings/speaker-diarization-model-download-progress',
                cancelledMessage: DOWNLOAD_CANCELLED_MESSAGE,
                modelDisplayName: '声纹嵌入模型',
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }

    public async getStatus(): Promise<DiarizationModelStatus> {
        const [segmentation, embedding] = await Promise.all([
            this.segmentation.getStatus(),
            this.embedding.getStatus(),
        ]);
        return {
            segmentationReady: segmentation.ready,
            embeddingReady: embedding.ready,
            ready: segmentation.ready && embedding.ready,
            segmentationUrls: segmentation.downloadUrls,
            embeddingUrls: embedding.downloadUrls,
        };
    }

    public async download(): Promise<{ success: boolean; message: string }> {
        const segmentation = await this.segmentation.download();
        if (!segmentation.success) {
            return segmentation;
        }
        return await this.embedding.download();
    }

    public async cancelDownload(): Promise<{ cancelled: boolean }> {
        // 两个安装器各自持有取消控制器；当前下载只在其中一个上，逐个尝试即可。
        const [segmentation, embedding] = await Promise.all([
            this.segmentation.cancelDownload(),
            this.embedding.cancelDownload(),
        ]);
        return { cancelled: segmentation.cancelled || embedding.cancelled };
    }

    public async deleteModel(): Promise<{ success: boolean; message: string }> {
        const segmentation = await this.segmentation.deleteModel();
        const embedding = await this.embedding.deleteModel();
        return {
            success: segmentation.success && embedding.success,
            message: `${segmentation.message}；${embedding.message}`,
        };
    }
}

/**
 * 把模型状态转成通用安装状态 VO，供统一资源卡片复用。
 *
 * 分割模型体积可忽略，展示时只报声纹嵌入模型的字节数，避免把两个文件的
 * 体积相加后与单一下载地址对不上。
 *
 * @param status 聚合状态。
 * @returns 通用安装状态。
 */
export function toInstallationStatus(status: DiarizationModelStatus): ModelInstallationStatusVO {
    return {
        modelPath: '',
        ready: status.ready,
        missingFiles: status.ready ? [] : ['segmentation', 'embedding'],
        downloading: false,
        phase: null,
        percent: 0,
        downloadUrls: [...status.segmentationUrls, ...status.embeddingUrls],
        archivePath: '',
    };
}

/** 声纹嵌入模型的精确字节数；设置页展示体积时使用。 */
export const DIARIZATION_TOTAL_BYTES = DIARIZATION_EMBEDDING_BYTES;
