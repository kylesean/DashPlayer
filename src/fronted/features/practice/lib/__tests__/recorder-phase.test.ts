import { describe, expect, it } from 'vitest';
import {
    isCapturing,
    nextRecorderPhase,
    type PracticeRecorderEvent,
    type PracticeRecorderPhase,
} from '@/fronted/features/practice/lib/recorder-phase';

const PHASES: PracticeRecorderPhase[] = ['idle', 'requesting', 'recording', 'processing'];
const EVENTS: PracticeRecorderEvent[] = ['START', 'MIC_READY', 'STOP', 'CANCEL', 'SCORED', 'EMPTY'];

const LEGAL_COMBINATIONS = new Set([
    'idle+START',
    'requesting+MIC_READY',
    'requesting+CANCEL',
    'recording+STOP',
    'recording+CANCEL',
    'recording+EMPTY',
    'processing+SCORED',
]);

const ALL_PHASE_EVENT_ROWS: Array<[PracticeRecorderPhase, PracticeRecorderEvent, boolean]> = PHASES.flatMap(
    (phase) => EVENTS.map((event): [PracticeRecorderPhase, PracticeRecorderEvent, boolean] => [
        phase,
        event,
        LEGAL_COMBINATIONS.has(`${phase}+${event}`),
    ]),
);

describe('跟读录音的阶段转移', () => {
    it('主路径：空闲 → 等待麦克风 → 采集 → 评分 → 空闲', () => {
        expect(nextRecorderPhase('idle', 'START')).toBe('requesting');
        expect(nextRecorderPhase('requesting', 'MIC_READY')).toBe('recording');
        expect(nextRecorderPhase('recording', 'STOP')).toBe('processing');
        expect(nextRecorderPhase('processing', 'SCORED')).toBe('idle');
    });

    it('丢弃路径：等待授权或采集中取消直接回到空闲，不经过评分', () => {
        expect(nextRecorderPhase('requesting', 'CANCEL')).toBe('idle');
        expect(nextRecorderPhase('recording', 'CANCEL')).toBe('idle');
    });

    it('空录音不进入评分，直接回到空闲', () => {
        expect(nextRecorderPhase('recording', 'EMPTY')).toBe('idle');
    });

    it('评分中拒绝取消：否则用户能再开一段录音与仍在进行的评分并发', () => {
        // 这条是上一轮修复自身引入缺陷后补的回归断言：
        // 若 cancel() 不判阶段，phase 会被打回 idle，评分结果随后挂到错误的句子上。
        expect(nextRecorderPhase('processing', 'CANCEL')).toBeNull();
        expect(nextRecorderPhase('processing', 'START')).toBeNull();
        expect(nextRecorderPhase('processing', 'STOP')).toBeNull();
    });

    it('等待授权时二次开始被拒：双触发不得并行打开两条 MediaStream', () => {
        expect(nextRecorderPhase('requesting', 'START')).toBeNull();
        expect(nextRecorderPhase('recording', 'START')).toBeNull();
    });

    it.each(['STOP', 'SCORED', 'EMPTY', 'MIC_READY'] as const)(
        '空闲时收尾类事件 %s 不生效',
        (event) => {
            expect(nextRecorderPhase('idle', event)).toBeNull();
        },
    );

    it.each(ALL_PHASE_EVENT_ROWS)(
        '事件矩阵：%s + %s 合法性应为 %s',
        (phase, event, isLegal) => {
            expect(nextRecorderPhase(phase, event) !== null).toBe(isLegal);
        },
    );

    it('只有采集阶段算占用麦克风', () => {
        expect(isCapturing('recording')).toBe(true);
        expect(isCapturing('idle')).toBe(false);
        expect(isCapturing('requesting')).toBe(false);
        // 评分阶段已经停采，只是等结果：此时释放轨道是对的，不该被当成还在采
        expect(isCapturing('processing')).toBe(false);
    });
});
