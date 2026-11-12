import { inject, injectable } from 'inversify';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import TYPES from '@/backend/ioc/types';
import ModelArchiveService from '@/backend/services/models/ModelArchiveService';
import type SettingService from '@/backend/services/SettingService';
import {
    SHERPA_TTS_REQUIRED_FILES,
    resolveSherpaTtsVoice,
    sherpaTtsDownloadUrls,
    type SherpaTtsVoice,
} from '@/backend/services/models/sherpaTtsModel';
import type LocalModelService from '@/backend/services/models/LocalModelService';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';

/**
 * 绑定到某个具体音色的归档安装器。
 *
 * `ModelArchiveService` 的构造参数是 protected，无法在外层按音色临时拼装，
 * 因此用这个薄子类把「音色 → 安装配置」的映射固定下来。
 */
class VoiceModelArchiveService extends ModelArchiveService {
    /**
     * @param voice 该安装器负责的音色。
     * @param rendererGateway 进度事件出口。
     * @param storageDirectoryProvider 存储目录解析。
     * @param fileSystemGateway 文件系统访问。
     */
    constructor(
        voice: SherpaTtsVoice,
        rendererGateway: RendererGateway,
        storageDirectoryProvider: StorageDirectoryProvider,
        fileSystemGateway: FileSystemGateway,
    ) {
        super(
            {
                downloadUrls: sherpaTtsDownloadUrls(voice),
                archiveSha256: voice.archiveSha256,
                // 每个音色一个工作目录：断点续传的临时归档不能跨音色复用。
                workDirectoryName: `.sherpa-tts-download-${voice.id}`,
                archiveFileName: voice.archiveName,
                modelDirectoryName: voice.directoryName,
                requiredFiles: [voice.modelFileName, ...SHERPA_TTS_REQUIRED_FILES],
                progressEventName: 'settings/sherpa-tts-model-download-progress',
                cancelledMessage: 'Sherpa TTS 模型下载已取消',
                modelDisplayName: `Sherpa TTS (${voice.id})`,
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }
}

/**
 * Sherpa-ONNX Piper 英语 TTS 模型管理。
 *
 * 支持多音色（美音/英音 × 男/女）：每个音色是独立归档、独立安装目录。
 * 状态与下载都以「当前选中的音色」为准——装了别的音色不会误报就绪，
 * 切换音色后设置页会按需提示下载。
 */
@injectable()
export class SherpaTtsModelServiceImpl implements LocalModelService {
    /** 当前音色对应的安装器；音色切换时重建。 */
    private installer: VoiceModelArchiveService;

    /** 构建 `installer` 时使用的音色 id，用于判断是否需要重建。 */
    private installerVoiceId: string;

    private readonly rendererGateway: RendererGateway;

    private readonly storageDirectoryProvider: StorageDirectoryProvider;

    private readonly fileSystemGateway: FileSystemGateway;

    constructor(
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) fileSystemGateway: FileSystemGateway,
        @inject(TYPES.SettingService) private readonly settingService: SettingService,
    ) {
        this.rendererGateway = rendererGateway;
        this.storageDirectoryProvider = storageDirectoryProvider;
        this.fileSystemGateway = fileSystemGateway;
        const voice = resolveSherpaTtsVoice(this.settingService.getSherpaTtsVoice());
        this.installerVoiceId = voice.id;
        this.installer = this.buildInstaller(voice);
    }

    /** @inheritdoc */
    public async getStatus(): Promise<ModelInstallationStatusVO> {
        return this.currentInstaller().getStatus();
    }

    /** @inheritdoc */
    public async download(): Promise<{ success: boolean; message: string }> {
        return this.currentInstaller().download();
    }

    /** @inheritdoc */
    public async cancelDownload(): Promise<{ cancelled: boolean }> {
        return this.currentInstaller().cancelDownload();
    }

    /** @inheritdoc */
    public async deleteModel(): Promise<{ success: boolean; message: string }> {
        return this.currentInstaller().deleteModel();
    }

    /**
     * 取当前音色的安装器；用户切换音色后按需重建。
     *
     * 旧音色进行中的下载不会被取消——它属于另一个音色，用户可能只是先切过去看看。
     *
     * @returns 与当前选中音色匹配的安装器。
     */
    private currentInstaller(): VoiceModelArchiveService {
        const voice = resolveSherpaTtsVoice(this.settingService.getSherpaTtsVoice());
        if (voice.id !== this.installerVoiceId) {
            this.installerVoiceId = voice.id;
            this.installer = this.buildInstaller(voice);
        }
        return this.installer;
    }

    /**
     * 按音色构造安装器。
     *
     * @param voice 音色配置。
     * @returns 该音色的安装器。
     */
    private buildInstaller(voice: SherpaTtsVoice): VoiceModelArchiveService {
        return new VoiceModelArchiveService(
            voice,
            this.rendererGateway,
            this.storageDirectoryProvider,
            this.fileSystemGateway,
        );
    }
}
