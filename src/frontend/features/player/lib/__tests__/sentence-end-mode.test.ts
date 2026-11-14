import { describe, expect, it } from 'vitest';

import {
    clearSentenceEndModes,
    deriveSentenceEndMode,
    disableSentenceEndMode,
    enableSentenceEndMode,
    hasSentenceEndModeConflict,
    resolveSentenceEndStage,
    toggleSentenceEndMode,
    type SentenceEndStageFlags,
    type SentenceEndModeFlags,
} from '@/frontend/features/player/lib/sentence-end-mode';

/** 全关闭的标志集合。 */
const off: SentenceEndModeFlags = { autoPause: false, singleRepeat: false, shadowing: false };
/** 全关闭（含悬停层）的标志集合。 */
const stageOff: SentenceEndStageFlags = { ...off, hoverRepeat: false };

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
        expect(deriveSentenceEndMode(dirty, false)).toBe('autoPause');
        expect(hasSentenceEndModeConflict(off, true)).toBe(false);
        expect(hasSentenceEndModeConflict(dirty, true)).toBe(true);
    });

    it('裁决顺序必须与引擎 onTimeUpdate 的分支顺序一致', () => {
        const all: SentenceEndModeFlags = { autoPause: true, singleRepeat: true, shadowing: true };

        // 全开：sentenceLoop 最优先
        expect(deriveSentenceEndMode(all, true)).toBe('sentenceLoop');
        // 关掉 loop：autoPause 赢（引擎里它排在 singleRepeat 之前）
        expect(deriveSentenceEndMode(all, false)).toBe('autoPause');
        // 再关掉 autoPause：singleRepeat 赢
        expect(deriveSentenceEndMode({ ...all, autoPause: false }, false)).toBe('singleRepeat');
        // 只剩 shadowing
        expect(deriveSentenceEndMode({ ...all, autoPause: false, singleRepeat: false }, false))
            .toBe('shadowing');
    });

    it('执行阶段裁决与 UI 派生共用同一份顺序，且悬停循环压在影子跟读之前', () => {
        expect(resolveSentenceEndStage(stageOff, false)).toBe('off');
        expect(resolveSentenceEndStage({ ...stageOff, hoverRepeat: true }, false)).toBe('hoverRepeat');
        // 悬停层与影子跟读并存时，悬停优先（否则会被跟读暂停打断）
        expect(resolveSentenceEndStage({ ...stageOff, hoverRepeat: true, shadowing: true }, false))
            .toBe('hoverRepeat');
        // 持久模式的优先级仍然高于悬停层
        expect(resolveSentenceEndStage({ ...stageOff, hoverRepeat: true, singleRepeat: true }, false))
            .toBe('singleRepeat');
        // 常开循环最优先
        expect(resolveSentenceEndStage({ ...stageOff, hoverRepeat: true, autoPause: true }, true))
            .toBe('sentenceLoop');
        // 执行阶段与 UI 派生对持久模式给出同一结论
        const persistent = { ...stageOff, autoPause: true, singleRepeat: true, shadowing: true };
        expect(resolveSentenceEndStage(persistent, false)).toBe(
            deriveSentenceEndMode(persistent, false),
        );
    });
});
