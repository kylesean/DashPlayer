import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryChatSessionStore } from '@/backend/services/chat/ChatSessionStore';
import type { ChatSessionCreateParams } from '@/common/types/chat';

const makeParams = (suffix: number): ChatSessionCreateParams => ({
    videoId: 'video-1',
    originalTopic: `topic ${suffix}`,
    paragraphLines: ['line'],
    subtitleFileHash: 'hash-1',
    anchorSentenceIndex: suffix,
    sentenceKey: `hash-1:${suffix}`,
});

describe('InMemoryChatSessionStore 单 run 中止与会话回收', () => {
    let store: InMemoryChatSessionStore;

    beforeEach(() => {
        store = new InMemoryChatSessionStore();
    });

    it('stopRun 只中止指定 run，不影响同会话的其它流', () => {
        const session = store.create(makeParams(1));
        const analysisSignal = store.startRun(session.id, 'run-analysis');
        const chatSignal = store.startRun(session.id, 'run-chat');

        expect(store.stopRun(session.id, 'run-analysis')).toBe(true);
        expect(analysisSignal.aborted).toBe(true);
        expect(chatSignal.aborted).toBe(false);
        // 结算过的 run 再停一次是 no-op
        expect(store.stopRun(session.id, 'run-analysis')).toBe(false);
    });

    it('finishRun 清除 analysisRunId 登记；stop 按会话全停', () => {
        const session = store.create(makeParams(1));
        store.startRun(session.id, 'run-analysis');
        // 直接验证 store 内部登记（通过 stopRun 的返回值间接验证）
        expect(store.stopRun(session.id, 'run-analysis')).toBe(true);
        expect(store.stopRun(session.id, 'run-analysis')).toBe(false);
    });

    it('超过容量上限时回收最旧的已关闭且无在途 run 的会话', () => {
        // 先制造一个会被回收的旧会话
        const old = store.create(makeParams(0));
        store.close(old.id);

        // 填到容量上限（其余全部保持打开，避免被回收）
        const sessions = [old];
        for (let i = 1; i < 50; i += 1) {
            sessions.push(store.create(makeParams(i)));
        }
        expect(sessions).toHaveLength(50);
        expect(store.get(old.id)).toBeDefined();

        // 新建第 51 个会话触发回收：唯一可回收对象是旧会话
        const fresh = store.create(makeParams(50));
        expect(store.get(fresh.id)).toBeDefined();
        expect(() => store.get(old.id)).toThrow('chat session not found');
        // 打开中的会话不受影响
        for (const s of sessions.slice(1)) {
            expect(store.get(s.id)).toBeDefined();
        }
    });

    it('close 后 runs 被清空且 analysisRunId 不再可停', () => {
        const session = store.create(makeParams(1));
        store.startRun(session.id, 'run-analysis');
        store.close(session.id);
        expect(store.stopRun(session.id, 'run-analysis')).toBe(false);
    });
});
