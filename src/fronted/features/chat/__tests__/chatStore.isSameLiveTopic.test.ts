import { beforeEach, describe, expect, it, vi } from 'vitest';

// chatStore 拖带的依赖面很大，这里只替身它真正触达的部分：
// usePlayer（当前句/句子表/暂停）、playbackSessionStore（videoId）、chatApi、视图同步与音频。
const { playerState, playbackState } = vi.hoisted(() => ({
    playerState: {
        currentSentence: null as { text: string; index: number; fileHash: string } | null,
        sentences: [] as { text: string; index: number; fileHash: string }[],
    },
    playbackState: {
        videoId: 'video-a' as string | null,
    },
}));

vi.mock('@/fronted/features/player/playerStore', () => ({
    usePlayer: {
        getState: () => ({
            currentSentence: playerState.currentSentence,
            sentences: playerState.sentences,
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
        completeSentence: vi.fn(),
        closeSession: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn(),
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

/** 把会话面板摆到「视频 A 第 0 行已有存活会话」的基线。 */
const seedSession = (fileHash: string): void => {
    useChatPanel.setState({
        chatSessionId: 'sess-a',
        topicKey: 'Yes.',
        anchorIndex: 0,
        anchorFileHash: fileHash,
        hasLearningContext: true,
        learningVisible: false,
        analysis: null,
    });
};

describe('chatStore 同句判重的跨视频边界', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        playbackState.videoId = 'video-a';
        playerState.sentences = [];
        useChatPanel.setState({ chatSessionId: '', topicKey: null, anchorIndex: null, anchorFileHash: null });
    });

    it('同一视频同一句：沿用现有会话，不重建', async () => {
        seedSession('hash-a');
        playerState.currentSentence = { text: 'Yes.', index: 0, fileHash: 'hash-a' };

        await useChatPanel.getState().createFromCurrent();

        expect(chatApi.createSession).not.toHaveBeenCalled();
        expect(chatApi.closeSession).not.toHaveBeenCalled();
        expect(useChatPanel.getState().chatSessionId).toBe('sess-a');
        expect(useChatPanel.getState().learningVisible).toBe(true);
    });

    it('不同视频相同文本相同索引：不认作同一句，关闭旧会话并重建', async () => {
        seedSession('hash-a');
        // 视频第 0 行的常见短句完全可能撞车：文本与索引一致，字幕文件不同
        playerState.currentSentence = { text: 'Yes.', index: 0, fileHash: 'hash-b' };
        vi.mocked(chatApi.createSession).mockResolvedValue({ sessionId: 'sess-b' } as never);

        await useChatPanel.getState().createFromCurrent();

        expect(chatApi.closeSession).toHaveBeenCalledWith('sess-a');
        expect(chatApi.createSession).toHaveBeenCalledTimes(1);
        expect(useChatPanel.getState().chatSessionId).toBe('sess-b');
        expect(useChatPanel.getState().anchorFileHash).toBe('hash-b');
    });
});
