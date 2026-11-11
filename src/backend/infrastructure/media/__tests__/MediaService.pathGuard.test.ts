import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

import { MediaServiceImpl } from '@/backend/services/MediaService';
import MediaPathRegistry from '@/backend/services/MediaPathRegistry';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type FfmpegService from '@/backend/services/FfmpegService';
import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';

// 日志模块是系统边界：测试里静音，避免真实落盘和对 Electron app 的依赖。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

const LIBRARY_ROOT = path.join('/', 'library');

/** 只返回固定媒体库根、并把权限检查变成空操作的目录提供器。 */
const createProvider = (): StorageDirectoryProvider => ({
    provideDirectory: vi.fn(async (target: StorageDirectoryTarget) =>
        target === StorageDirectoryTarget.LIBRARY_ROOT ? LIBRARY_ROOT : path.join(LIBRARY_ROOT, 'temp')),
    ensurePathAccessPermissionIfExists: vi.fn(async () => undefined),
} as unknown as StorageDirectoryProvider);

/** 记录调用但不真正跑 ffmpeg 的服务替身。 */
const createFfmpeg = (): FfmpegService => ({
    thumbnail: vi.fn(async () => undefined),
    duration: vi.fn(async () => 10),
    getVideoInfo: vi.fn(async () => ({ filename: 'x', duration: 10 })),
} as unknown as FfmpegService);

describe('MediaService 媒体路径授权', () => {
    let gateway: MemoryFileSystemGateway;
    let registry: MediaPathRegistry;
    let service: MediaServiceImpl;

    beforeEach(async () => {
        gateway = new MemoryFileSystemGateway();
        registry = new MediaPathRegistry();
        service = new MediaServiceImpl(createProvider(), createFfmpeg(), gateway as unknown as FileSystemGateway, registry);
        // 媒体库外的用户文件：默认不应被这三条路由碰到
        await gateway.writeTextFile(path.join('/', 'home', 'user', 'private.mp4'), 'bytes');
    });

    it('媒体库内的路径直接放行', async () => {
        const inLibrary = path.join(LIBRARY_ROOT, 'videos', 'a.mp4');
        await gateway.writeTextFile(inLibrary, 'bytes');

        await expect(service.info(inLibrary)).resolves.toBeTruthy();
    });

    it('后端登记过的库外路径放行（用户自己挑的视频）', async () => {
        const outside = path.join('/', 'home', 'user', 'private.mp4');
        registry.allowFile(outside);

        await expect(service.info(outside)).resolves.toBeTruthy();
    });

    it('库外且未登记的路径被拒绝，不会交给 ffprobe 解析', async () => {
        const outside = path.join('/', 'home', 'user', 'private.mp4');

        await expect(service.info(outside)).rejects.toThrow('媒体路径未授权');
        await expect(service.duration(outside)).rejects.toThrow('媒体路径未授权');
        await expect(service.thumbnail(outside, 1)).rejects.toThrow('媒体路径未授权');
    });

    it('拒绝时不会在媒体库 temp 里留下缩略图', async () => {
        const outside = path.join('/', 'home', 'user', 'private.mp4');

        await expect(service.thumbnail(outside, 1)).rejects.toThrow('媒体路径未授权');

        const tempNames = await gateway.listFileNames(path.join(LIBRARY_ROOT, 'temp'));
        expect(tempNames).toEqual([]);
    });

    it('越界到媒体库父目录的路径不被当成库内路径', async () => {
        // /library-backup 以 /library 为前缀，但不是库内
        const sibling = path.join('/', 'library-backup', 'x.mp4');
        await gateway.writeTextFile(sibling, 'bytes');

        await expect(service.info(sibling)).rejects.toThrow('媒体路径未授权');
    });
});
