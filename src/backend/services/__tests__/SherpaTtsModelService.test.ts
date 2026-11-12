import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { SherpaTtsModelServiceImpl } from '@/backend/services/SherpaTtsModelService';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type SettingService from '@/backend/services/SettingService';
import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';

describe('SherpaTtsModelService 音色切换与取消生命周期', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('切换音色后仍可取消之前音色的在途下载，且切回原音色不会丢失原下载任务', async () => {
        let currentVoice = 'en-US-lessac-medium';
        const fsGateway = new MemoryFileSystemGateway();
        const service = new SherpaTtsModelServiceImpl(
            { call: vi.fn(), fireAndForget: vi.fn() } as unknown as RendererGateway,
            { provideDirectory: async () => '/models' } as unknown as StorageDirectoryProvider,
            fsGateway,
            { getSherpaTtsVoice: () => currentVoice } as unknown as SettingService,
        );

        const abortHandlers: Array<() => void> = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
            const signal = (init as RequestInit | undefined)?.signal;
            return new Promise((_resolve, reject) => {
                const rejectAbort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                if (signal?.aborted) {
                    rejectAbort();
                    return;
                }
                signal?.addEventListener('abort', () => {
                    abortHandlers.push(rejectAbort);
                }, { once: true });
            });
        });

        const downloadLessac = service.download().catch(() => ({ success: false, message: 'cancelled' }));
        await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

        // 切到另一音色后，再切回原音色应看到原音色仍在下载中（而非新建第二份写入器）
        currentVoice = 'en-GB-alba-medium';
        const albaStatus = await service.getStatus();
        expect(albaStatus.downloading).toBe(false);

        currentVoice = 'en-US-lessac-medium';
        const lessacStatus = await service.getStatus();
        expect(lessacStatus.downloading).toBe(true);

        // 切到 alba 时点取消，也能取消 lessac 的在途下载
        currentVoice = 'en-GB-alba-medium';
        const cancelPromise = service.cancelDownload();
        await vi.waitFor(() => expect(abortHandlers.length).toBeGreaterThan(0));
        abortHandlers.splice(0).forEach((trigger) => trigger());
        await expect(cancelPromise).resolves.toEqual({ cancelled: true });
        await downloadLessac;
    });
});
