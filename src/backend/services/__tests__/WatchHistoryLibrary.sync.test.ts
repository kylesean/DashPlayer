import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

import { createMemoryDb, type MemoryDb } from '@/test/database';
import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';
import WatchHistoryLibrary from '@/backend/services/WatchHistoryLibrary';
import WatchHistoryRepositoryImpl from '@/backend/infrastructure/db/repositories/WatchHistoryRepositoryImpl';
import WatchHistoryExtRepositoryImpl from '@/backend/infrastructure/db/repositories/WatchHistoryExtRepositoryImpl';
import { watchHistory } from '@/backend/infrastructure/db/tables/watchHistory';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';

// 日志与文件系统都是系统边界：测试里静音并用内存实现替代。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

const LIBRARY_ROOT = path.join('/', 'library');
const VIDEOS = path.join(LIBRARY_ROOT, 'videos');

/** 只提供固定目录、并把权限检查变成空操作的目录提供器。 */
const createProvider = (): StorageDirectoryProvider => ({
    provideDirectory: vi.fn(async (target: StorageDirectoryTarget) => {
        if (target === StorageDirectoryTarget.VIDEOS) return VIDEOS;
        if (target === StorageDirectoryTarget.LIBRARY_ROOT) return LIBRARY_ROOT;
        return path.join(LIBRARY_ROOT, String(target));
    }),
    ensurePathAccessPermissionIfExists: vi.fn(async () => undefined),
} as unknown as StorageDirectoryProvider);

describe('WatchHistoryLibrary 同步并发', () => {
    let memoryDb: MemoryDb;
    let gateway: MemoryFileSystemGateway;
    let library: WatchHistoryLibrary;

    beforeEach(async () => {
        memoryDb = createMemoryDb();
        gateway = new MemoryFileSystemGateway();
        library = new WatchHistoryLibrary(
            new WatchHistoryRepositoryImpl(memoryDb.db),
            new WatchHistoryExtRepositoryImpl(memoryDb.db),
            createProvider(),
            gateway,
        );
        await gateway.ensureDirectory(VIDEOS);
        await gateway.writeTextFile(path.join(VIDEOS, 'a.mp4'), 'bytes');
        await gateway.writeTextFile(path.join(VIDEOS, 'b.mp4'), 'bytes');
    });

    afterEach(() => {
        memoryDb.close();
    });

    /** 读取当前观看记录条数。 */
    const countRecords = async (): Promise<number> => {
        const rows = await memoryDb.db.select().from(watchHistory);
        return rows.length;
    };

    it('并发调用 sync 不会因为重复插入同一确定性主键而抛错', async () => {
        // 启动清理后的 sync 与首屏 list 的 sync 会重叠，这是真实触发路径
        await expect(Promise.all([library.sync(), library.sync(), library.sync()])).resolves.toBeDefined();

        expect(await countRecords()).toBe(2);
    });

    it('并发 sync 之后串行 sync 仍是幂等的，不会重复建档', async () => {
        await Promise.all([library.sync(), library.sync()]);
        await library.sync();

        expect(await countRecords()).toBe(2);
    });

    it('同一路径的并发 ensureRecord 收敛成同一条记录', async () => {
        const videoPath = path.join(VIDEOS, 'a.mp4');

        const [first, second] = await Promise.all([
            library.ensureRecord(videoPath),
            library.ensureRecord(videoPath),
        ]);

        expect(first).toEqual(second);
        expect(await countRecords()).toBe(1);
    });
});
