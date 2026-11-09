import { describe, expect, it } from 'vitest';

import {
    DpTaskState,
    TERMINAL_DP_TASK_STATES,
    isTerminalDpTaskState,
} from '@/common/contracts/dp-task';

describe('后台任务终态判定', () => {
    it('成功、失败、取消是终态', () => {
        expect(isTerminalDpTaskState(DpTaskState.DONE)).toBe(true);
        expect(isTerminalDpTaskState(DpTaskState.FAILED)).toBe(true);
        expect(isTerminalDpTaskState(DpTaskState.CANCELLED)).toBe(true);
    });

    it('进行中与未开始不是终态', () => {
        expect(isTerminalDpTaskState(DpTaskState.INIT)).toBe(false);
        expect(isTerminalDpTaskState(DpTaskState.IN_PROGRESS)).toBe(false);
    });

    it('缺失或未知状态安全地判为非终态', () => {
        expect(isTerminalDpTaskState(undefined)).toBe(false);
        expect(isTerminalDpTaskState(null)).toBe(false);
        expect(isTerminalDpTaskState('')).toBe(false);
        expect(isTerminalDpTaskState('expired')).toBe(false);
    });

    it('终态清单与实际判定保持一致', () => {
        const allStates = Object.values(DpTaskState);
        const terminalFromList = allStates.filter((state) => isTerminalDpTaskState(state));
        expect(new Set(terminalFromList)).toEqual(new Set(TERMINAL_DP_TASK_STATES));
    });
});
