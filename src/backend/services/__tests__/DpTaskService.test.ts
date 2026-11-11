import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryDb, type MemoryDb } from '@/test/database';
import { dpTask } from '@/backend/infrastructure/db/tables/dpTask';
import DpTaskRepositoryImpl from '@/backend/infrastructure/db/repositories/DpTaskRepositoryImpl';
import { DpTaskState } from '@/common/contracts/dp-task';
import TimeUtil from '@/common/utils/TimeUtil';
import { concurrency } from '@/backend/utils/concurrency';
import type RendererEvents from '@/backend/services/gateways/renderer/RendererEvents';
import { DpTaskServiceImpl } from '../DpTaskService';

// 日志基建依赖 electron app（AppStatePath → app.isPackaged），服务层测试替换为空实现。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** 终态任务保留时长：7 天，与服务实现保持一致。 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 机会式清理的最小间隔：1 小时。 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 冻结的“现在”，让保留期截止时间可精确断言。 */
const BASE_TIME = new Date('2026-01-10T00:00:00.000Z');

/**
 * 等待条件成立。
 *
 * 计时用 performance.now 而不是 Date.now：测试里 Date 被冻结，
 * 用它做超时判断会永远等不到超时。
 */
const waitUntil = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> => {
    const deadline = performance.now() + timeoutMs;
    while (!(await predicate())) {
        if (performance.now() > deadline) {
            throw new Error('等待条件超时');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

/**
 * 后台任务保留策略测试。
 *
 * 仓储使用真实 SQLite 内存库（服务层测试不 mock 仓储），
 * 清理条件、状态白名单与截止时间都以真实落库结果为准。
 */
describe('后台任务保留策略', () => {
    let memoryDb: MemoryDb;
    let repository: DpTaskRepositoryImpl;
    let service: DpTaskServiceImpl;
    let deleteTerminalBefore: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // 只冻结 Date，定时器保持真实，异步落库流程照常推进。
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(BASE_TIME);
        memoryDb = createMemoryDb();
        repository = new DpTaskRepositoryImpl(memoryDb.db);
        service = new DpTaskServiceImpl({
            dpTaskUpdate: vi.fn(),
            storeUpdate: vi.fn(),
            windowStateUpdate: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
        } as unknown as RendererEvents, repository);
        deleteTerminalBefore = vi.spyOn(repository, 'deleteTerminalBefore');
    });

    afterEach(() => {
        vi.useRealTimers();
        memoryDb.close();
        vi.restoreAllMocks();
    });

    /** 插入一条指定状态与更新时间的任务行。 */
    const insertTask = async (status: DpTaskState, updatedAt: Date, progress: string): Promise<void> => {
        const stamp = TimeUtil.dateToUtc(updatedAt);
        await memoryDb.db.insert(dpTask).values({
            status,
            progress,
            created_at: stamp,
            updated_at: stamp,
        });
    };

    /** 读取全部任务行，按插入顺序返回进度描述。 */
    const listProgress = async (): Promise<(string | null)[]> => {
        const rows = await memoryDb.db.select().from(dpTask);
        return rows.map((row) => row.progress);
    };

    it('删除超过保留期的终态任务，保留期内的终态任务不受影响', async () => {
        await insertTask(DpTaskState.DONE, new Date(BASE_TIME.getTime() - 8 * 24 * 60 * 60 * 1000), '过期成功');
        await insertTask(DpTaskState.FAILED, new Date(BASE_TIME.getTime() - 8 * 24 * 60 * 60 * 1000), '过期失败');
        await insertTask(DpTaskState.CANCELLED, new Date(BASE_TIME.getTime() - 8 * 24 * 60 * 60 * 1000), '过期取消');
        await insertTask(DpTaskState.DONE, new Date(BASE_TIME.getTime() - 24 * 60 * 60 * 1000), '期内成功');

        await service.cleanupExpiredTasks();

        expect(await listProgress()).toEqual(['期内成功']);
    });

    it('活动任务即使远超保留期也不会被删除', async () => {
        await insertTask(DpTaskState.INIT, new Date(BASE_TIME.getTime() - 30 * 24 * 60 * 60 * 1000), '过期待处理');
        await insertTask(DpTaskState.IN_PROGRESS, new Date(BASE_TIME.getTime() - 30 * 24 * 60 * 60 * 1000), '过期处理中');

        await service.cleanupExpiredTasks();

        expect(await listProgress()).toEqual(['过期待处理', '过期处理中']);
    });

    it('清理使用按七天保留期计算的截止时间', async () => {
        await service.cleanupExpiredTasks();

        expect(deleteTerminalBefore).toHaveBeenCalledTimes(1);
        const cutoff = deleteTerminalBefore.mock.calls[0][0];
        expect(cutoff).toBe(TimeUtil.dateToUtc(new Date(BASE_TIME.getTime() - RETENTION_MS)));
    });

    it('任务落库时机会式清理，一小时内最多触发一次', async () => {
        await service.cleanupExpiredTasks();
        expect(deleteTerminalBefore).toHaveBeenCalledTimes(1);

        const taskId = await service.create();
        service.finish(taskId, { progress: '完成' });
        // 等待任务状态真正落库，再留出窗口让可能触发的清理落地。
        await waitUntil(async () => (await listProgress()).includes('完成'));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(deleteTerminalBefore).toHaveBeenCalledTimes(1);

        // 时间推过一小时后，下一次任务落库会重新触发清理。
        vi.setSystemTime(new Date(BASE_TIME.getTime() + CLEANUP_INTERVAL_MS + 1000));
        service.finish(taskId, { progress: '再次完成' });
        await waitUntil(() => deleteTerminalBefore.mock.calls.length === 2);
        expect(deleteTerminalBefore).toHaveBeenCalledTimes(2);
    });

    it('在资源信号量上下文里落库时清理依然能执行', async () => {
        const taskId = await service.create();

        // 任务进度可能在资源信号量（yt-dlp 下载）持有期间更新，
        // 此时清理不能因为锁顺序校验被跳过。
        await concurrency.withSemaphore('yt-dlp', async () => {
            service.finish(taskId, { progress: '下载完成' });
            await waitUntil(async () => (await listProgress()).includes('下载完成'));
        });

        await waitUntil(() => deleteTerminalBefore.mock.calls.length >= 1);
        expect(deleteTerminalBefore).toHaveBeenCalledTimes(1);
    });

    it('刚创建的任务在 detail 里带 result: null，而不是缺字段的 undefined', async () => {
        const taskId = await service.create();

        const detail = await service.detail(taskId);

        // 跨进程契约要求 result: string | null；缺键会让 result === null 的判断失配
        expect(detail).not.toBeNull();
        expect(Object.prototype.hasOwnProperty.call(detail, 'result')).toBe(true);
        expect(detail?.result).toBeNull();
    });

    it('更新过 result 的任务在 detail 里返回该值', async () => {
        const taskId = await service.create();
        service.finish(taskId, { result: '{"ok":true}' });

        const detail = await service.detail(taskId);

        expect(detail?.result).toBe('{"ok":true}');
    });
});
