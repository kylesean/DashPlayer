import fs from 'fs';
import path from 'path';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type LocalModelService from '@/backend/services/models/LocalModelService';
import {
    PHONEME_GOP_MODEL_DIRECTORY,
    PHONEME_GOP_MODEL_FILE,
    PHONEME_GOP_MODEL_URLS,
    PHONEME_GOP_REQUIRED_FILES,
    PHONEME_GOP_VOCAB_FILE,
    PHONEME_GOP_VOCAB_URLS,
} from '@/backend/services/models/phonemeGopModel';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';
import type { ModelDownloadPhase } from '@/common/contracts/model-download-phase';

/**
 * 离线音素 GOP 声学模型安装与管理服务（支持断点/进度广播、取消与删除）。
 */
@injectable()
export class PhonemeGopModelServiceImpl implements LocalModelService {
    private readonly logger = getMainLogger('PhonemeGopModelService');
    private activeAbort: AbortController | null = null;
    private downloading: Promise<{ success: boolean; message: string }> | null = null;

    constructor(
        @inject(TYPES.RendererGateway) private readonly rendererGateway: RendererGateway,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    public async getStatus(): Promise<ModelInstallationStatusVO> {
        const modelPath = await this.getModelDir();
        const missingFiles: string[] = [];
        for (const file of PHONEME_GOP_REQUIRED_FILES) {
            const exists = await this.fileSystemGateway.fileExists(path.join(modelPath, file));
            if (!exists) {
                missingFiles.push(file);
            }
        }
        return {
            ready: missingFiles.length === 0,
            modelPath,
            missingFiles,
            downloading: this.downloading !== null,
            phase: this.downloading ? 'downloading' : null,
            percent: 0,
            downloadUrls: [...PHONEME_GOP_MODEL_URLS],
            archivePath: path.join(modelPath, PHONEME_GOP_MODEL_FILE),
        };
    }

    public async download(): Promise<{ success: boolean; message: string }> {
        if (this.downloading) {
            return this.downloading;
        }
        const status = await this.getStatus();
        if (status.ready) {
            return { success: true, message: '音素 GOP 模型已就绪' };
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
        return { success: true, message: '音素 GOP 模型已删除' };
    }

    private async getModelDir(): Promise<string> {
        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        return path.join(modelsRoot, PHONEME_GOP_MODEL_DIRECTORY);
    }

    private async runDownload(): Promise<{ success: boolean; message: string }> {
        const abortController = new AbortController();
        this.activeAbort = abortController;
        const modelDir = await this.getModelDir();
        const workDir = `${modelDir}.downloading`;

        try {
            await this.fileSystemGateway.ensureDirectory(workDir);
            await this.downloadWithFallback(
                PHONEME_GOP_VOCAB_URLS,
                path.join(workDir, PHONEME_GOP_VOCAB_FILE),
                abortController.signal,
                false,
            );
            await this.downloadWithFallback(
                PHONEME_GOP_MODEL_URLS,
                path.join(workDir, PHONEME_GOP_MODEL_FILE),
                abortController.signal,
                true,
            );

            await this.fileSystemGateway.ensureDirectory(modelDir);
            for (const file of PHONEME_GOP_REQUIRED_FILES) {
                const src = path.join(workDir, file);
                const dest = path.join(modelDir, file);
                if (await this.fileSystemGateway.fileExists(dest)) {
                    await this.fileSystemGateway.removeFileIfExists(dest);
                }
                await fs.promises.rename(src, dest);
            }
            await this.fileSystemGateway.removeDirectoryIfExists(workDir).catch(() => undefined);
            this.emitProgress(100, 0, 0, 'idle');
            return { success: true, message: '音素 GOP 模型安装完成' };
        } catch (error) {
            await this.fileSystemGateway.removeDirectoryIfExists(workDir).catch(() => undefined);
            if (abortController.signal.aborted) {
                this.emitProgress(0, 0, 0, 'idle');
                return { success: false, message: '音素 GOP 模型下载已取消' };
            }
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('音素 GOP 模型下载失败', { error: message });
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
        this.rendererGateway.fireAndForget('settings/phoneme-gop-model-download-progress', {
            percent,
            downloaded,
            total,
            phase,
        });
    }
}
