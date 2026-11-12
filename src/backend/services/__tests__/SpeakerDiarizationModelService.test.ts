import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-diarization-model-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import {
    SpeakerDiarizationModelServiceImpl,
    toInstallationStatus,
} from '@/backend/services/SpeakerDiarizationModelService';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';

/**
 * 构造服务实例，依赖全部用最小桩替换。
 */
const build = () => new SpeakerDiarizationModelServiceImpl(
    { fireAndForget: vi.fn() } as unknown as RendererGateway,
    { provideDirectory: async () => '/tmp/models' } as unknown as StorageDirectoryProvider,
    {
        pathIsMissing: async () => true,
        directoryExists: async () => false,
        removeDirectoryIfExists: async () => undefined,
        removeFileIfExists: async () => undefined,
        ensureDirectory: async () => undefined,
        listDirectoryNames: async () => [],
        getFileSize: async () => 0,
        moveFile: async () => undefined,
    } as unknown as FileSystemGateway,
);

describe('SpeakerDiarizationModelServiceImpl', () => {
    it('两个模型都缺失时状态为未就绪，并给出各自下载地址', async () => {
        const service = build();

        const status = await service.getStatus();

        expect(status.ready).toBe(false);
        expect(status.segmentationReady).toBe(false);
        expect(status.embeddingReady).toBe(false);
        expect(status.segmentationUrls).toHaveLength(1);
        expect(status.embeddingUrls).toHaveLength(1);
    });

    it('删除模型对两个目录都执行，返回聚合结果', async () => {
        const service = build();

        const result = await service.deleteModel();

        expect(result.success).toBe(true);
        expect(result.message).toContain('说话人分割模型');
        expect(result.message).toContain('声纹嵌入模型');
    });

    it('无下载任务时取消返回未取消', async () => {
        const service = build();

        await expect(service.cancelDownload()).resolves.toEqual({ cancelled: false });
    });
});

describe('toInstallationStatus', () => {
    it('就绪时缺失文件为空', () => {
        const status = toInstallationStatus({
            segmentationReady: true,
            embeddingReady: true,
            ready: true,
            segmentationUrls: ['https://a'],
            embeddingUrls: ['https://b'],
        });

        expect(status.ready).toBe(true);
        expect(status.missingFiles).toEqual([]);
        expect(status.downloadUrls).toEqual(['https://a', 'https://b']);
    });

    it('未就绪时列出两个缺失项', () => {
        const status = toInstallationStatus({
            segmentationReady: true,
            embeddingReady: false,
            ready: false,
            segmentationUrls: [],
            embeddingUrls: [],
        });

        expect(status.ready).toBe(false);
        expect(status.missingFiles).toEqual(['segmentation', 'embedding']);
    });

    it('两阶段下载中途取消后不会继续下载第二阶段，且 getStatus 暴露 downloading 状态', async () => {
        const service = build();
        const seg = (service as unknown as {
            segmentation: { download: () => Promise<{ success: boolean; message: string }>; cancelDownload: () => Promise<{ cancelled: boolean }> };
            embedding: { download: () => Promise<{ success: boolean; message: string }>; cancelDownload: () => Promise<{ cancelled: boolean }> };
        });
        let finishSeg!: (res: { success: boolean; message: string }) => void;
        vi.spyOn(seg.segmentation, 'download').mockImplementation(
            () => new Promise((resolve) => {
                finishSeg = resolve;
            }),
        );
        vi.spyOn(seg.segmentation, 'cancelDownload').mockResolvedValue({ cancelled: true });
        const embDownload = vi.spyOn(seg.embedding, 'download').mockResolvedValue({ success: true, message: 'ok' });

        const dlPromise = service.download().catch((error: unknown) => error);
        const midStatus = await service.getStatus();
        expect(midStatus.downloading).toBe(true);

        const cancelPromise = service.cancelDownload();
        finishSeg({ success: true, message: 'ok' });

        await expect(cancelPromise).resolves.toEqual({ cancelled: true });
        const outcome = await dlPromise;
        expect(outcome).toBeInstanceOf(Error);
        expect(embDownload).not.toHaveBeenCalled();
    });
});
