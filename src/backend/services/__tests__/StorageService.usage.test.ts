import { describe, expect, it, vi } from 'vitest';

import { StorageServiceImpl } from '@/backend/services/StorageService';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';

/**
 * 构造一个按目录返回固定占用大小的文件系统网关。
 *
 * @param sizes 目录绝对路径 → 字节数。
 * @returns 只实现用量查询所需方法的网关。
 */
const createGateway = (sizes: Record<string, number>): FileSystemGateway => ({
    getDirectorySize: vi.fn(async (dir: string) => sizes[dir] ?? 0),
    getDirectorySizeIfExists: vi.fn(async (dir: string) => sizes[dir] ?? 0),
} as unknown as FileSystemGateway);

/** 构造只返回固定根目录的存储目录提供器。 */
const createProvider = (root: string): StorageDirectoryProvider => ({
    provideDirectory: vi.fn(async () => root),
} as unknown as StorageDirectoryProvider);

/** 构造只返回固定配置的设置存储。 */
const createSettings = (): SettingsStore => ({
    get: vi.fn(() => undefined),
} as unknown as SettingsStore);

describe('StorageService 存储用量分类', () => {
    it('收藏片段按 favorite_clips 减去 word_video 后单独成项，各分类之和等于总量', async () => {
        const root = '/library';
        const sizes = {
            '/library': 1000,
            '/library/videos': 400,
            '/library/favorite_clips': 300,
            '/library/favorite_clips/word_video': 120,
            '/library/temp': 50,
            '/library/temp_oss': 10,
            '/library/models': 100,
        };
        const service = new StorageServiceImpl(createSettings(), createProvider(root), createGateway(sizes));

        const usage = await service.queryStorageUsage();
        const byCategory = new Map(usage.items.map((item) => [item.category, item.bytes]));

        // favorite_clips 内除 word_video 外的部分单独成项
        expect(byCategory.get('favorite_clips')).toBe(180);
        expect(byCategory.get('word_clips')).toBe(120);
        // word_video 不重复计入 favorite_clips
        expect(byCategory.get('favorite_clips')).not.toBe(300);
        // 已知分类之和 + other 必须与总量一致
        const sum = usage.items.reduce((acc, item) => acc + item.bytes, 0);
        expect(sum).toBe(usage.totalBytes);
    });

    it('word_video 大于 favorite_clips 时收藏片段按 0 处理，不出现负数', async () => {
        const root = '/library';
        const sizes = {
            '/library': 500,
            '/library/favorite_clips': 100,
            '/library/favorite_clips/word_video': 150,
        };
        const service = new StorageServiceImpl(createSettings(), createProvider(root), createGateway(sizes));

        const usage = await service.queryStorageUsage();
        const byCategory = new Map(usage.items.map((item) => [item.category, item.bytes]));

        expect(byCategory.has('favorite_clips')).toBe(false);
        expect(byCategory.get('word_clips')).toBe(150);
        expect(usage.items.every((item) => item.bytes >= 0)).toBe(true);
    });

    it('各分类覆盖契约里的全部已知目录', async () => {
        const root = '/library';
        const sizes = {
            '/library': 100,
            '/library/videos': 10,
            '/library/favorite_clips': 20,
            '/library/favorite_clips/word_video': 5,
            '/library/temp': 1,
            '/library/models': 1,
        };
        const service = new StorageServiceImpl(createSettings(), createProvider(root), createGateway(sizes));

        const usage = await service.queryStorageUsage();
        const categories = usage.items.map((item) => item.category);

        expect(categories).toContain('videos');
        expect(categories).toContain('favorite_clips');
        expect(categories).toContain('word_clips');
        expect(categories).toContain('models');
        expect(categories).toContain('temp');
    });
});

describe('StorageService 目录目标解析', () => {
    it('只查询固定子目录，不重复统计父目录', async () => {
        const root = '/library';
        const gateway = createGateway({ '/library': 10 });
        const service = new StorageServiceImpl(createSettings(), createProvider(root), gateway);

        await service.queryStorageUsage();

        const queried = (gateway.getDirectorySizeIfExists as unknown as { mock: { calls: string[][] } }).mock.calls
            .map((call) => call[0]);
        expect(queried).toContain('/library/videos');
        expect(queried).toContain('/library/favorite_clips');
        expect(queried).toContain('/library/favorite_clips/word_video');
        expect(queried).toContain('/library/temp');
        expect(queried).toContain('/library/temp_oss');
        expect(queried).toContain('/library/models');
        // LIBRARY_ROOT 由 getDirectorySize 单独统计，不进子目录列表
        expect(queried).not.toContain('/library');
        expect(StorageDirectoryTarget.LIBRARY_ROOT).toBe('library_root');
    });
});
