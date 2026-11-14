import { beforeEach, describe, expect, it, vi } from 'vitest';

// 与 isSameLiveTopic 测试同一套替身策略：只替身 chatStore 真正触达的依赖。
const { playerState, playbackState } = vi.hoisted(() => ({
    playerState: {
        currentSentence: null as { text: string; index: number; fileHash: string } | null,
        sentences: [] as { text: string; index: number; fileHash: string }[],
    },
    playbackState: {
        videoId: 'video-a' as string | null,
    },
}));

vi.mock('@/frontend/features/player/playerStore', () => ({
    usePlayer: {
        getState: () => ({
            currentSentence: playerState.currentSentence,
            sentences: playerState.sentences,
            pause: () => {},
        }),
    },
}));

vi.mock('@/frontend/features/player/playbackSessionStore', () => ({
    usePlaybackSession: {
        getState: () => playbackState,
    },
}));

vi.mock('@/frontend/features/chat/chatApi', () => ({
    chatApi: {
        learningAvailable: vi.fn().mockResolvedValue(false),
        completeSentence: vi.fn(),
        closeSession: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn(),
    },
}));

vi.mock('@/frontend/features/player/lib/player-view-sync', () => ({
    beginOverlayView: vi.fn(),
}));

vi.mock('@/frontend/infrastructure/audio/AudioPlayer', () => ({
    getTtsUrl: vi.fn(),
    playAudioUrl: vi.fn(),
}));

vi.mock('@/frontend/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { chatApi } from '@/frontend/features/chat/chatApi';
import useChatPanel from '../chatStore';
import { deriveLearningPhase } from '../lib/learningSessionPhase';

const sentence = { text: 'Yes.', index: 0, fileHash: 'hash-a' } as never;

/** createSession 的手动放行器：按调用顺序入列，测试体在恰当时机放行。 */
const pendingSessionResolvers: Array<(value: { sessionId: string }) => void> = [];
const stubPendingCreateSession = (): void => {
    vi.mocked(chatApi.createSession).mockImplementation(
        () => new Promise<{ sessionId: string }>((resolve) => {
            pendingSessionResolvers.push(resolve);
        }) as never,
    );
};

/** 放空微任务队列：让乐观进入与 createSession 的挂起真正发生。 */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('chatStore learningEntry 单写者收敛', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playbackState.videoId = 'video-a';
        playerState.sentences = [];
        useChatPanel.setState({
            chatSessionId: '',
            topicKey: null,
            anchorIndex: null,
            anchorFileHash: null,
            learningVisible: false,
            hasLearningContext: false,
            sentenceResolveError: null,
        });
        vi.mocked(chatApi.createSession).mockResolvedValue({ sessionId: 'sess-a' } as never);
    });

    it('乐观进入 → resolving；会话建立 → ready；隐藏 → hidden', async () => {
        playerState.currentSentence = sentence;
        // 手动放行 createSession：制造真实的「乐观可见但会话未建」窗口
        stubPendingCreateSession();

        const promise = useChatPanel.getState().openSentenceSession(sentence);
        await flushMicrotasks();

        // createSession 尚未返回：乐观窗口内可见但无会话
        expect(useChatPanel.getState().learningVisible).toBe(true);
        expect(useChatPanel.getState().chatSessionId).toBe('');
        expect(
            deriveLearningPhase({
                learningVisible: useChatPanel.getState().learningVisible,
                chatSessionId: useChatPanel.getState().chatSessionId,
                sentenceResolveError: useChatPanel.getState().sentenceResolveError,
            }),
        ).toBe('resolving');

        pendingSessionResolvers.shift()?.({ sessionId: 'sess-a' });
        await promise;

        expect(useChatPanel.getState().chatSessionId).toBe('sess-a');
        expect(
            deriveLearningPhase({
                learningVisible: useChatPanel.getState().learningVisible,
                chatSessionId: useChatPanel.getState().chatSessionId,
                sentenceResolveError: useChatPanel.getState().sentenceResolveError,
            }),
        ).toBe('ready');

        useChatPanel.getState().hideLearning();
        expect(useChatPanel.getState().learningVisible).toBe(false);
        // hasLearningContext 保持挂载（Layout 依据），重开同句走 reopen 直接回现场
        expect(useChatPanel.getState().hasLearningContext).toBe(true);
    });

    it('会话创建失败：错误保留、工作台隐藏、其余状态归零（resetLearningState 保留清单）', async () => {
        playerState.currentSentence = sentence;
        vi.mocked(chatApi.createSession).mockRejectedValue(new Error('boom'));

        await expect(useChatPanel.getState().openSentenceSession(sentence)).rejects.toThrow('boom');

        expect(useChatPanel.getState().sentenceResolveError).toBe('boom');
        expect(useChatPanel.getState().learningVisible).toBe(false);
        expect(useChatPanel.getState().chatSessionId).toBe('');
        expect(useChatPanel.getState().anchorIndex).toBeNull();
        expect(useChatPanel.getState().topicText).toBe('');
        expect(
            deriveLearningPhase({
                learningVisible: useChatPanel.getState().learningVisible,
                chatSessionId: useChatPanel.getState().chatSessionId,
                sentenceResolveError: useChatPanel.getState().sentenceResolveError,
            }),
        ).toBe('failed');
    });

    it('在途请求期间 hideLearning：会话建好但保持隐藏（learningCloseRequested 协议）', async () => {
        playerState.currentSentence = sentence;
        stubPendingCreateSession();

        const promise = useChatPanel.getState().openSentenceSession(sentence);
        await flushMicrotasks();
        expect(useChatPanel.getState().learningVisible).toBe(true);

        // 在途时请求关闭：不撤请求，只登记意图
        useChatPanel.getState().hideLearning();
        expect(useChatPanel.getState().learningVisible).toBe(false);

        pendingSessionResolvers.shift()?.({ sessionId: 'sess-x' });
        await promise;

        // 会话已建立（保留现场），finally 依据关闭标记补隐藏
        expect(useChatPanel.getState().chatSessionId).toBe('sess-x');
        expect(useChatPanel.getState().learningVisible).toBe(false);
    });
});
