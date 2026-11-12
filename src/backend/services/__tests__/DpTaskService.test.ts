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

/**
 * 终态守卫与 cache-miss 读路径测试。
 *
 * 背景：迟到的 onProgress（clearInterval 后仍在飞的 getStatus().then）曾把
 * CANCELLED 覆写回 IN_PROGRESS；重启恢复的遗留任务不在 cache 里，
 * notify→detail 走 DB 读只能拿到 300ms 防抖窗口前的旧状态。
 */
describe('任务状态终态守卫与 cache-miss 读路径', () => {
    let memoryDb: MemoryDb;
    let repository: DpTaskRepositoryImpl;
    let service: DpTaskServiceImpl;

    beforeEach(() => {
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
    });

    afterEach(() => {
        vi.useRealTimers();
        memoryDb.close();
        vi.restoreAllMocks();
    });

    it('已终态的任务拒绝被非终态更新复活', async () => {
        const taskId = await service.create();
        service.update({ id: taskId, status: DpTaskState.CANCELLED, progress: '任务取消' });

        // 迟到的进度回调试图把任务拉回进行中
        service.process(taskId, { progress: '下载中 80%' });

        const detail = await service.detail(taskId);
        expect(detail?.status).toBe(DpTaskState.CANCELLED);
        expect(detail?.progress).toBe('任务取消');
    });

    it('终态 → 终态的重复收尾幂等放行', async () => {
        const taskId = await service.create();
        service.update({ id: taskId, status: DpTaskState.CANCELLED, progress: '任务取消' });
        // 取消链路的第二处 CANCELLED 写入（checkCancel 与 catch 双写）必须不报错
        service.update({ id: taskId, status: DpTaskState.CANCELLED, progress: '任务取消' });

        const detail = await service.detail(taskId);
        expect(detail?.status).toBe(DpTaskState.CANCELLED);
    });

    it('cache miss 时 detail 把未落库增量合并到 DB 行上', async () => {
        // 直接插库（不经 service.create），模拟重启恢复的遗留任务：不在 cache 里
        const stamp = TimeUtil.dateToUtc(new Date(BASE_TIME.getTime() - 1000));
        const [row] = await memoryDb.db.insert(dpTask).values({
            status: DpTaskState.IN_PROGRESS,
            progress: '下载中 10%',
            created_at: stamp,
            updated_at: stamp,
        }).returning();

        // 非终态增量走 300ms 防抖，尚未落库
        service.update({ id: row.id, status: DpTaskState.IN_PROGRESS, progress: '下载中 80%' });

        // detail 必须返回合并后的最新状态；DB 行仍是旧值（防抖未到期）
        const detail = await service.detail(row.id);
        expect(detail?.status).toBe(DpTaskState.IN_PROGRESS);
        expect(detail?.progress).toBe('下载中 80%');
        const dbRow = await repository.findById(row.id);
        expect(dbRow?.progress).toBe('下载中 10%');
    });

    it('CANCELLED 终态后到达的不同终态（DONE/FAILED）同样被拒绝覆写', async () => {
        const taskId = await service.create();
        service.update({ id: taskId, status: DpTaskState.CANCELLED, progress: '任务取消' });

        service.finish(taskId, { progress: '完成', result: '{"videoId":"x"}' });
        service.fail(taskId, { progress: '失败', result: 'boom' });

        const detail = await service.detail(taskId);
        expect(detail?.status).toBe(DpTaskState.CANCELLED);
        expect(detail?.progress).toBe('任务取消');
    });

    it('落库连续异常时采用退避调度而不是 0ms 热循环反复刷库', async () => {
        const updateSpy = vi.spyOn(repository, 'updateById').mockRejectedValue(new Error('SQLITE_BUSY'));
        const taskId = await service.create();
        service.finish(taskId, { progress: '完成' });

        await Promise.resolve();
        await Promise.resolve();
        // 首次立即刷写失败后应转为退避定时重试，而不是在微任务里无限连刷。
        expect(updateSpy).toHaveBeenCalledTimes(1);
    });
});
