import { describe, expect, it } from 'vitest';
import {
    collectSchedulableIndices,
    decideFailedBatchOutcome,
    getIndexState,
    markIndicesCompleted,
    markIndicesDead,
    markIndicesInFlight,
    releaseInFlightIndices,
    type SubtitleIndexState,
} from '../subtitle-translation-index-state';

describe('字幕坐标状态表', () => {
    it('未记录的坐标视为待调度，三种终态/在途状态都能原样读回', () => {
        const states = new Map<number, SubtitleIndexState>([
            [1, 'in-flight'],
            [2, 'completed'],
            [3, 'dead'],
        ]);

        expect(getIndexState(states, 0)).toBe('queued');
        expect(getIndexState(states, 1)).toBe('in-flight');
        expect(getIndexState(states, 2)).toBe('completed');
        expect(getIndexState(states, 3)).toBe('dead');
    });

    it('只有待调度坐标能进入新批次，顺序保持不变', () => {
        const states = new Map<number, SubtitleIndexState>([
            [1, 'in-flight'],
            [3, 'completed'],
            [5, 'dead'],
        ]);

        expect(collectSchedulableIndices(states, [0, 1, 2, 3, 4, 5])).toEqual([0, 2, 4]);
    });

    it('批次收尾只释放在途占位，不会把完成或死信打回待调度', () => {
        const states = new Map<number, SubtitleIndexState>();
        markIndicesInFlight(states, [0, 1, 2, 3]);
        markIndicesCompleted(states, [0, 1]);
        markIndicesDead(states, [2]);

        releaseInFlightIndices(states, [0, 1, 2, 3]);

        expect(getIndexState(states, 0)).toBe('completed');
        expect(getIndexState(states, 1)).toBe('completed');
        expect(getIndexState(states, 2)).toBe('dead');
        // 只有仍然在途的坐标回到待调度，等待下一次窗口调度。
        expect(getIndexState(states, 3)).toBe('queued');
    });

    it('失败批次判定优先级：无重试坐标 > 离开窗口 > 重试耗尽 > 重新入队', () => {
        expect(decideFailedBatchOutcome({
            retryableCount: 0,
            inCurrentWindow: false,
            requeueCount: 99,
            maxRequeueCount: 2,
        })).toBe('ignore');

        // 已离开窗口的批次即使重试次数耗尽也只记 dropped：
        // 结果已写缓存，重试对死会话无意义，观测口径也不能变。
        expect(decideFailedBatchOutcome({
            retryableCount: 3,
            inCurrentWindow: false,
            requeueCount: 99,
            maxRequeueCount: 2,
        })).toBe('dropped');

        expect(decideFailedBatchOutcome({
            retryableCount: 3,
            inCurrentWindow: true,
            requeueCount: 2,
            maxRequeueCount: 2,
        })).toBe('dead-letter');

        expect(decideFailedBatchOutcome({
            retryableCount: 3,
            inCurrentWindow: true,
            requeueCount: 1,
            maxRequeueCount: 2,
        })).toBe('requeue');
    });

    it('重试上限为 0 时首次失败即进入死信', () => {
        expect(decideFailedBatchOutcome({
            retryableCount: 1,
            inCurrentWindow: true,
            requeueCount: 0,
            maxRequeueCount: 0,
        })).toBe('dead-letter');
    });
});
