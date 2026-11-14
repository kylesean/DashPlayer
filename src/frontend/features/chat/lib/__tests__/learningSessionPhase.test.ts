import { describe, expect, it } from 'vitest';

import { deriveLearningPhase } from '../learningSessionPhase';

const facts = (overrides: Partial<Parameters<typeof deriveLearningPhase>[0]> = {}) => ({
    learningVisible: false,
    chatSessionId: '',
    sentenceResolveError: null,
    ...overrides,
});

describe('deriveLearningPhase', () => {
    it('关闭且无失败残留 → hidden', () => {
        expect(deriveLearningPhase(facts())).toBe('hidden');
    });

    it('乐观进入窗口：可见但会话未建 → resolving', () => {
        expect(deriveLearningPhase(facts({ learningVisible: true }))).toBe('resolving');
    });

    it('resolving 期间的信息性错误（云可用性探测失败）仍归 resolving', () => {
        // 已接受组合态：流程继续，错误由 UI 另行展示
        expect(
            deriveLearningPhase(facts({ learningVisible: true, sentenceResolveError: '探测失败' })),
        ).toBe('resolving');
    });

    it('会话就绪 → ready', () => {
        expect(deriveLearningPhase(facts({ learningVisible: true, chatSessionId: 'sess-a' }))).toBe('ready');
    });

    it('隐藏但保留现场（会话仍在）→ hidden（重开同句走 reopen 回现场）', () => {
        expect(deriveLearningPhase(facts({ chatSessionId: 'sess-a' }))).toBe('hidden');
    });

    it('不可见且错误残留 → failed', () => {
        expect(deriveLearningPhase(facts({ sentenceResolveError: 'boom' }))).toBe('failed');
    });
});
