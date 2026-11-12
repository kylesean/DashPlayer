import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DpTaskState, type DpTask } from '@/common/contracts/dp-task';

const { mockCall, mockOnTaskUpdate } = vi.hoisted(() => ({
    mockCall: vi.fn(),
    mockOnTaskUpdate: vi.fn(),
}));

vi.mock('@/fronted/infrastructure/electron/backendClient', () => ({
    backendClient: { call: mockCall },
}));

vi.mock('@/fronted/infrastructure/electron/rendererEvents', () => ({
    rendererEvents: { onTaskUpdate: mockOnTaskUpdate },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import useDpTaskCenter, {
    mergeIncomingDpTask,
    shouldApplyDetailSnapshot,
    startListeningToDpTasks,
    stopListeningToDpTasks,
} from '@/fronted/app/stores/dpTaskStore';

const makeTask = (id: number, status: DpTaskState, progress: string | null = null): DpTask => ({
    id,
    status,
    progress,
    result: null,
    created_at: '2026-11-13 00:00:00',
    updated_at: '2026-11-13 00:00:00',
});

describe('dpTaskStore 状态合并与极快任务不丢回调', () => {
    let pushHandler: ((task: DpTask) => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        pushHandler = null;
        stopListeningToDpTasks();
        useDpTaskCenter.setState({ tasks: new Map() });
        mockOnTaskUpdate.mockImplementation((cb: (task: DpTask) => void) => {
            pushHandler = cb;
            return () => {
                pushHandler = null;
            };
        });
        startListeningToDpTasks();
    });

    it('终态一旦写入，不被非终态推送或慢回的 detail 快照覆盖', async () => {
        const doneTask = makeTask(101, DpTaskState.DONE, '100%');
        const oldInProgress = makeTask(101, DpTaskState.IN_PROGRESS, '10%');

        expect(mergeIncomingDpTask(doneTask, oldInProgress)).toBe(doneTask);
        expect(shouldApplyDetailSnapshot(doneTask, oldInProgress)).toBe(false);
        expect(shouldApplyDetailSnapshot(oldInProgress, doneTask)).toBe(true);

        let resolveDetail!: (task: DpTask | null) => void;
        mockCall.mockImplementation(
            () => new Promise<DpTask | null>((resolve) => {
                resolveDetail = resolve;
            }),
        );

        const onFinish = vi.fn();
        await useDpTaskCenter.getState().register(async () => 101, { onFinish });

        // dp-task/detail 尚在途中时，IPC 已先推来 DONE
        pushHandler?.(doneTask);
        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(onFinish).toHaveBeenCalledWith(doneTask);

        // 随后迟到的 detail 返回较旧的 IN_PROGRESS，绝不能把缓存覆写回进行中
        resolveDetail(oldInProgress);
        await Promise.resolve();
        await Promise.resolve();
        expect(useDpTaskCenter.getState().tasks.get(101)?.valueOf()).toEqual(doneTask);
    });

    it('任务在 func() await 期间就已推送终态时，register 仍可靠触发 onUpdated 与 onFinish', async () => {
        const doneTask = makeTask(202, DpTaskState.DONE, 'done');
        mockCall.mockResolvedValue(doneTask);

        const onUpdated = vi.fn();
        const onFinish = vi.fn();

        await useDpTaskCenter.getState().register(
            async () => {
                pushHandler?.(doneTask);
                return 202;
            },
            { onUpdated, onFinish },
        );

        expect(onUpdated).toHaveBeenCalledTimes(1);
        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(onFinish).toHaveBeenCalledWith(doneTask);
    });
});
