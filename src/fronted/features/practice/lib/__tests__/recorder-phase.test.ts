import { describe, expect, it } from 'vitest';
import {
    isCapturing,
    nextRecorderPhase,
    type PracticeRecorderEvent,
    type PracticeRecorderPhase,
} from '@/fronted/features/practice/lib/recorder-phase';

const PHASES: PracticeRecorderPhase[] = ['idle', 'recording', 'processing'];
const EVENTS: PracticeRecorderEvent[] = ['START', 'STOP', 'CANCEL', 'SCORED', 'EMPTY'];

describe('跟读录音的阶段转移', () => {
    it('主路径：空闲 → 采集 → 评分 → 空闲', () => {
        expect(nextRecorderPhase('idle', 'START')).toBe('recording');
        expect(nextRecorderPhase('recording', 'STOP')).toBe('processing');
        expect(nextRecorderPhase('processing', 'SCORED')).toBe('idle');
    });

    it('丢弃路径：采集中取消直接回到空闲，不经过评分', () => {
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

    it('空闲时重复开始被拒，不会产生第二段采集', () => {
        expect(nextRecorderPhase('recording', 'START')).toBeNull();
    });

    it('空闲时不会有收尾类事件生效', () => {
        for (const event of ['STOP', 'SCORED', 'EMPTY'] as const) {
            expect(nextRecorderPhase('idle', event), event).toBeNull();
        }
    });

    it('全事件矩阵：只有下表列出的组合合法', () => {
        const legal = new Set([
            'idle+START',
            'recording+STOP',
            'recording+CANCEL',
            'recording+EMPTY',
            'processing+SCORED',
        ]);
        for (const phase of PHASES) {
            for (const event of EVENTS) {
                const key = `${phase}+${event}`;
                const next = nextRecorderPhase(phase, event);
                if (legal.has(key)) {
                    expect(next, key).not.toBeNull();
                } else {
                    expect(next, key).toBeNull();
                }
            }
        }
    });

    it('只有采集阶段算占用麦克风', () => {
        expect(isCapturing('recording')).toBe(true);
        expect(isCapturing('idle')).toBe(false);
        // 评分阶段已经停采，只是等结果：此时释放轨道是对的，不该被当成还在采
        expect(isCapturing('processing')).toBe(false);
    });
});
