import { beforeEach, describe, expect, it, vi } from 'vitest';

// 与 isSameLiveTopic 测试同一套替身策略：只替身 chatStore 真正触达的依赖。
const { playbackState } = vi.hoisted(() => ({
    playbackState: {
        videoId: 'video-a' as string | null,
    },
}));

vi.mock('@/fronted/features/player/playerStore', () => ({
    usePlayer: {
        getState: () => ({
            currentSentence: null,
            sentences: [],
            pause: () => {},
        }),
    },
}));

vi.mock('@/fronted/features/player/playbackSessionStore', () => ({
    usePlaybackSession: {
        getState: () => playbackState,
    },
}));

vi.mock('@/fronted/features/chat/chatApi', () => ({
    chatApi: {
        learningAvailable: vi.fn().mockResolvedValue(false),
        closeSession: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn(),
        saveStudyNote: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/fronted/features/player/lib/player-view-sync', () => ({
    beginOverlayView: vi.fn(),
}));

vi.mock('@/fronted/infrastructure/audio/AudioPlayer', () => ({
    getTtsUrl: vi.fn(),
    playAudioUrl: vi.fn(),
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { chatApi } from '@/fronted/features/chat/chatApi';
import useChatPanel from '../chatStore';

type SaveStudyNoteParams = {
    sentenceKey: string;
    noteSummary: string;
};

/** 把会话面板摆到「视频 A 第 0 行、笔记为指定文本」的基线。 */
const seedNoteContext = (noteSummary: string): void => {
    useChatPanel.setState({
        chatSessionId: 'sess-a',
        anchorIndex: 0,
        anchorFileHash: 'hash-a',
        topicKey: 'Yes.',
        topicText: 'Yes.',
        hasLearningContext: true,
        learningVisible: true,
        noteSummary,
        noteSaving: false,
    });
};

/** 让 saveStudyNote 返回可手动放行的挂起 Promise；放行器按调用顺序入列。 */
const stubManualSave = (): Array<() => void> => {
    const resolvers: Array<() => void> = [];
    vi.mocked(chatApi.saveStudyNote).mockImplementation(
        () => new Promise((resolve) => {
            resolvers.push(() => resolve(undefined));
        }) as never,
    );
    return resolvers;
};

/** 放空微任务队列：让串行链上的 runPersist 真正开始执行并触达 IPC。 */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('chatStore 笔记持久化串行化', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playbackState.videoId = 'video-a';
        vi.mocked(chatApi.saveStudyNote).mockResolvedValue(undefined as never);
        seedNoteContext('v1');
    });

    it('并发保存串行排队：第一次 IPC 未决时第二次等待，不并行', async () => {
        const resolvers = stubManualSave();

        const first = useChatPanel.getState().saveNoteSummary();
        const second = useChatPanel.getState().saveNoteSummary();
        await flushMicrotasks();

        expect(chatApi.saveStudyNote).toHaveBeenCalledTimes(1);
        resolvers[0]?.();
        await flushMicrotasks();
        expect(chatApi.saveStudyNote).toHaveBeenCalledTimes(2);

        resolvers[1]?.();
        await Promise.allSettled([first, second]);
        expect(useChatPanel.getState().noteSaving).toBe(false);
    });

    it('排队期间的新输入随下一次保存落盘：不丢弃最新文本', async () => {
        const resolvers = stubManualSave();

        const first = useChatPanel.getState().saveNoteSummary();
        await flushMicrotasks();
        // 第一次仍在途：用户继续输入
        useChatPanel.getState().setNoteSummary('v1 typed more');
        const second = useChatPanel.getState().saveNoteSummary();

        resolvers[0]?.();
        await flushMicrotasks();

        const calls = vi.mocked(chatApi.saveStudyNote).mock.calls as unknown as SaveStudyNoteParams[][];
        expect(calls).toHaveLength(2);
        expect(calls[0]?.[0]?.noteSummary).toBe('v1');
        // 第二次执行时读取的是最新文本，而非入队时刻的旧值
        expect(calls[1]?.[0]?.noteSummary).toBe('v1 typed more');

        resolvers[1]?.();
        await Promise.allSettled([first, second]);
    });

    it('排队期间已切句：旧句保存作废，不把旧内容落到新句的键上', async () => {
        const resolvers = stubManualSave();

        const first = useChatPanel.getState().saveNoteSummary();
        await flushMicrotasks();
        // 第二次保存先入队（此时仍锚定第 0 句），然后用户切到下一句——
        // 第二次保存执行时锚点已易主，必须作废
        const second = useChatPanel.getState().saveNoteSummary();
        useChatPanel.setState({ anchorIndex: 1, anchorFileHash: 'hash-a', topicKey: 'Next.', noteSummary: '' });

        resolvers[0]?.();
        await flushMicrotasks();

        const calls = vi.mocked(chatApi.saveStudyNote).mock.calls as unknown as SaveStudyNoteParams[][];
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]?.sentenceKey).toContain('0');
        expect(useChatPanel.getState().noteSaving).toBe(false);

        await Promise.allSettled([first, second]);
    });

    it('appendToNoteSummary 基于最新值函数式合并并立即持久化', async () => {
        useChatPanel.getState().setNoteSummary('abc');

        await useChatPanel.getState().appendToNoteSummary('def');

        expect(useChatPanel.getState().noteSummary).toBe('abc\n\ndef');
        const calls = vi.mocked(chatApi.saveStudyNote).mock.calls as unknown as SaveStudyNoteParams[][];
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]?.noteSummary).toBe('abc\n\ndef');
    });

    it('合并落库后的继续输入随排队保存一并落盘', async () => {
        useChatPanel.getState().setNoteSummary('abc');
        const appendPromise = useChatPanel.getState().appendToNoteSummary('def');
        // 合并写入 store 之后、持久化真正执行之前，用户又输入了内容：
        // 串行链读取执行时刻的最新文本，追加内容与输入都不丢
        useChatPanel.getState().setNoteSummary(`${useChatPanel.getState().noteSummary} ghi`);

        await appendPromise;

        expect(useChatPanel.getState().noteSummary).toBe('abc\n\ndef ghi');
        const calls = vi.mocked(chatApi.saveStudyNote).mock.calls as unknown as SaveStudyNoteParams[][];
        expect(calls[0]?.[0]?.noteSummary).toBe('abc\n\ndef ghi');
    });

    it('clear 后极短时间内重开同一句：排队中的旧写入因代际失效而被丢弃', async () => {
        const resolvers = stubManualSave();

        const first = useChatPanel.getState().saveNoteSummary();
        await flushMicrotasks();
        const staleQueued = useChatPanel.getState().saveNoteSummary('stale snapshot');

        // 清空并立刻重开同一句（anchorIndex/anchorFileHash 相同）
        useChatPanel.getState().clear();
        seedNoteContext('fresh session note');

        resolvers[0]?.();
        await flushMicrotasks();
        await Promise.allSettled([first, staleQueued]);

        const calls = vi.mocked(chatApi.saveStudyNote).mock.calls as unknown as SaveStudyNoteParams[][];
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]?.noteSummary).toBe('v1');
    });
});
