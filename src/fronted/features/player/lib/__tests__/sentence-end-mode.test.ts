import { describe, expect, it } from 'vitest';

import {
    clearSentenceEndModes,
    deriveSentenceEndMode,
    disableSentenceEndMode,
    enableSentenceEndMode,
    hasSentenceEndModeConflict,
    toggleSentenceEndMode,
    type SentenceEndModeFlags,
} from '@/fronted/features/player/lib/sentence-end-mode';

/** 全关闭的标志集合。 */
const off: SentenceEndModeFlags = { autoPause: false, singleRepeat: false, shadowing: false };

describe('句末模式状态机', () => {
    it('无任何模式时推导为 off', () => {
        expect(deriveSentenceEndMode(off, false)).toBe('off');
        expect(hasSentenceEndModeConflict(off, false)).toBe(false);
    });

    it('单一布尔模式可被正确推导', () => {
        expect(deriveSentenceEndMode(enableSentenceEndMode('autoPause'), false)).toBe('autoPause');
        expect(deriveSentenceEndMode(enableSentenceEndMode('singleRepeat'), false)).toBe('singleRepeat');
        expect(deriveSentenceEndMode(enableSentenceEndMode('shadowing'), false)).toBe('shadowing');
    });

    it('常开逐句循环优先于布尔模式', () => {
        expect(deriveSentenceEndMode(off, true)).toBe('sentenceLoop');
    });

    it('互斥启用会关闭其他布尔模式', () => {
        const next = enableSentenceEndMode('shadowing');
        expect(next).toEqual({ autoPause: false, singleRepeat: false, shadowing: true });
        expect(hasSentenceEndModeConflict(next, false)).toBe(false);
    });

    it('关闭某个模式不会顺手打开其他模式', () => {
        const next = disableSentenceEndMode(enableSentenceEndMode('autoPause'), 'autoPause');
        expect(next).toEqual(off);
    });

    it('切换：未开启则互斥开启，已开启则仅关闭自身', () => {
        expect(toggleSentenceEndMode(off, 'autoPause')).toEqual(enableSentenceEndMode('autoPause'));
        expect(toggleSentenceEndMode(enableSentenceEndMode('autoPause'), 'autoPause')).toEqual(off);
    });

    it('切换时不会与另一种模式并存', () => {
        const next = toggleSentenceEndMode(enableSentenceEndMode('shadowing'), 'singleRepeat');
        expect(next).toEqual({ autoPause: false, singleRepeat: true, shadowing: false });
        expect(hasSentenceEndModeConflict(next, false)).toBe(false);
    });

    it('clearSentenceEndModes 清空全部布尔模式', () => {
        expect(clearSentenceEndModes()).toEqual(off);
    });

    it('能识别历史脏状态中的多模式并存', () => {
        const dirty: SentenceEndModeFlags = { autoPause: true, singleRepeat: true, shadowing: false };
        expect(hasSentenceEndModeConflict(dirty, false)).toBe(true);
        // 裁决顺序固定，保证不同订阅方得出同一结论
        expect(deriveSentenceEndMode(dirty, false)).toBe('singleRepeat');
        expect(hasSentenceEndModeConflict(off, true)).toBe(false);
        expect(hasSentenceEndModeConflict(dirty, true)).toBe(true);
    });
});
