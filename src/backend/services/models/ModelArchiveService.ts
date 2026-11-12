import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { ModelArchiveInstaller, type ModelArchiveInstallerOptions } from '@/backend/services/models/ModelArchiveInstaller';
import type LocalModelService from '@/backend/services/models/LocalModelService';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';

/**
 * 基于 {@link ModelArchiveInstaller} 的单归档模型服务基类。
 *
 * 各引擎的差异只有安装配置（下载地址、归档形态、必需文件、进度事件名），
 * 四个对外动作完全一致；子类只负责把配置交给基类。
 */
export default abstract class ModelArchiveService implements LocalModelService {
    private readonly installer: ModelArchiveInstaller;

    /**
     * @param options 该引擎的安装配置。
     * @param rendererGateway 进度事件出口。
     * @param storageDirectoryProvider 存储目录解析。
     * @param fileSystemGateway 文件系统访问。
     */
    protected constructor(
        options: ModelArchiveInstallerOptions,
        rendererGateway: RendererGateway,
        storageDirectoryProvider: StorageDirectoryProvider,
        fileSystemGateway: FileSystemGateway,
    ) {
        this.installer = new ModelArchiveInstaller(
            options,
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }

    /** @inheritdoc */
    public getStatus(): Promise<ModelInstallationStatusVO> {
        return this.installer.getStatus();
    }

    /** @inheritdoc */
    public download(): Promise<{ success: boolean; message: string }> {
        return this.installer.download();
    }

    /** @inheritdoc */
    public cancelDownload(): Promise<{ cancelled: boolean }> {
        return this.installer.cancelDownload();
    }

    /** @inheritdoc */
    public deleteModel(): Promise<{ success: boolean; message: string }> {
        return this.installer.deleteModel();
    }
}
