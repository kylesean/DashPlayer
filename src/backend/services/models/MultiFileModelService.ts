import fs from 'fs';
import path from 'path';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type LocalModelService from '@/backend/services/models/LocalModelService';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';
import type { ModelDownloadPhase } from '@/common/contracts/model-download-phase';

export interface MultiFileDownloadItem {
    /** 落盘文件名（位于 modelDirectoryName 下）。 */
    fileName: string;
    /** 有序镜像地址列表：优先尝试靠前镜像。 */
    urls: readonly string[];
    /** 是否把该文件字节流作为整体进度主指标（一般指向最大的模型权重文件）。 */
    reportProgress?: boolean;
}

export interface MultiFileModelSpec {
    /** 安装目录名（位于 MODELS 根目录下）。 */
    modelDirectoryName: string;
    /** 需顺序下载并校验的必需文件列表。 */
    files: readonly MultiFileDownloadItem[];
    /** 进度广播的 renderer IPC 事件名。 */
    progressEventName:
        | 'settings/phoneme-gop-model-download-progress'
        | 'settings/sense-voice-model-download-progress';
    /** 用于错误/状态文案的模型名称。 */
    modelDisplayName: string;
    /** status.downloadUrls 展示用的主权重地址列表。 */
    primaryDownloadUrls: readonly string[];
    /** status.archivePath 指向的主文件文件名。 */
    primaryFileName: string;
}

/**
 * 多文件直接下载型本地模型基类（无 tar 归档解压步骤）。
 *
 * 与 {@link ModelArchiveService} 平行：支持有序镜像回退、进度事件广播、
 * `.downloading` 临时目录原子切换、取消下载与整目录清理。
 */
export default abstract class MultiFileModelService implements LocalModelService {
    private readonly logger = getMainLogger('MultiFileModelService');
    private activeAbort: AbortController | null = null;
    private downloading: Promise<{ success: boolean; message: string }> | null = null;

    protected constructor(
        private readonly spec: MultiFileModelSpec,
        private readonly rendererGateway: RendererGateway,
        private readonly storageDirectoryProvider: StorageDirectoryProvider,
        private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    public async getStatus(): Promise<ModelInstallationStatusVO> {
        const modelPath = await this.getModelDir();
        const missingFiles: string[] = [];
        for (const item of this.spec.files) {
            const exists = await this.fileSystemGateway.fileExists(path.join(modelPath, item.fileName));
            if (!exists) {
                missingFiles.push(item.fileName);
            }
        }
        return {
            ready: missingFiles.length === 0,
            modelPath,
            missingFiles,
            downloading: this.downloading !== null,
            phase: this.downloading ? 'downloading' : null,
            percent: 0,
            downloadUrls: [...this.spec.primaryDownloadUrls],
            archivePath: path.join(modelPath, this.spec.primaryFileName),
        };
    }

    public async download(): Promise<{ success: boolean; message: string }> {
        if (this.downloading) {
            return this.downloading;
        }
        const status = await this.getStatus();
        if (status.ready) {
            return { success: true, message: `${this.spec.modelDisplayName}已就绪` };
        }
        const task = this.runDownload().finally(() => {
            this.downloading = null;
            this.activeAbort = null;
        });
        this.downloading = task;
        return task;
    }

    public async cancelDownload(): Promise<{ cancelled: boolean }> {
        if (!this.activeAbort) {
            return { cancelled: false };
        }
        this.activeAbort.abort();
        this.activeAbort = null;
        return { cancelled: true };
    }

    public async deleteModel(): Promise<{ success: boolean; message: string }> {
        await this.cancelDownload();
        const modelDir = await this.getModelDir();
        await this.fileSystemGateway.removeDirectoryIfExists(modelDir);
        return { success: true, message: `${this.spec.modelDisplayName}已删除` };
    }

    private async getModelDir(): Promise<string> {
        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        return path.join(modelsRoot, this.spec.modelDirectoryName);
    }

    private async runDownload(): Promise<{ success: boolean; message: string }> {
        const abortController = new AbortController();
        this.activeAbort = abortController;
        const modelDir = await this.getModelDir();
        const workDir = `${modelDir}.downloading`;

        try {
            await this.fileSystemGateway.ensureDirectory(workDir);
            for (const item of this.spec.files) {
                await this.downloadWithFallback(
                    item.urls,
                    path.join(workDir, item.fileName),
                    abortController.signal,
                    Boolean(item.reportProgress),
                );
            }

            await this.fileSystemGateway.ensureDirectory(modelDir);
            for (const item of this.spec.files) {
                const src = path.join(workDir, item.fileName);
                const dest = path.join(modelDir, item.fileName);
                if (await this.fileSystemGateway.fileExists(dest)) {
                    await this.fileSystemGateway.removeFileIfExists(dest);
                }
                await fs.promises.rename(src, dest);
            }
            await this.fileSystemGateway.removeDirectoryIfExists(workDir).catch(() => undefined);
            this.emitProgress(100, 0, 0, 'idle');
            return { success: true, message: `${this.spec.modelDisplayName}安装完成` };
        } catch (error) {
            await this.fileSystemGateway.removeDirectoryIfExists(workDir).catch(() => undefined);
            if (abortController.signal.aborted) {
                this.emitProgress(0, 0, 0, 'idle');
                return { success: false, message: `${this.spec.modelDisplayName}下载已取消` };
            }
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`${this.spec.modelDisplayName}下载失败`, { error: message });
            this.emitProgress(0, 0, 0, 'idle');
            return { success: false, message };
        }
    }

    private async downloadWithFallback(
        urls: readonly string[],
        targetPath: string,
        signal: AbortSignal,
        reportProgress: boolean,
    ): Promise<void> {
        let lastError: unknown = null;
        for (const url of urls) {
            try {
                const response = await fetch(url, { signal });
                if (!response.ok || !response.body) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const totalBytes = Number(response.headers.get('content-length') ?? '0');
                let receivedBytes = 0;
                const writer = fs.createWriteStream(targetPath);
                const reader = response.body.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            receivedBytes += value.byteLength;
                            writer.write(value);
                            if (reportProgress) {
                                const percent = totalBytes > 0
                                    ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
                                    : 0;
                                this.emitProgress(percent, receivedBytes, totalBytes, 'downloading');
                            }
                        }
                    }
                } finally {
                    await new Promise<void>((resolve, reject) => {
                        writer.end(() => resolve());
                        writer.on('error', reject);
                    });
                }
                return;
            } catch (error) {
                lastError = error;
                if (signal.aborted) {
                    throw error;
                }
            }
        }
        throw lastError instanceof Error ? lastError : new Error('下载失败');
    }

    private emitProgress(
        percent: number,
        downloaded: number,
        total: number,
        phase: ModelDownloadPhase,
    ): void {
        this.rendererGateway.fireAndForget(this.spec.progressEventName, {
            percent,
            downloaded,
            total,
            phase,
        });
    }
}
