import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useSWR from 'swr';

import SubtitleLearningHints from '../SubtitleLearningHints';
import type { ContextPackVO } from '@/common/types/contextPack';
import type { Sentence } from '@/common/types/SentenceC';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { togglePlayerView } from '@/fronted/features/player/lib/player-view-controller';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';

vi.mock('swr', () => ({
    default: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('../ContextSuggestionChip', () => ({
    default: () => <div data-testid="context-suggestion-stub" />,
}));

vi.mock('@/fronted/features/player/learningSessionStore', () => ({
    useLearningSessionSince: () => ({
        key: 'session-1',
        since: '2026-01-01T00:00:00.000Z',
    }),
}));

vi.mock('@/fronted/features/player/playerState', () => ({
    usePlayerState: () => false,
}));

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        contextPack: vi.fn(),
        rateReview: vi.fn(),
    },
}));

vi.mock('@/fronted/features/video-learning/reviewQueue', () => ({
    revalidateReviewQueue: vi.fn(),
}));

vi.mock('@/fronted/features/player/lib/player-view-controller', () => ({
    togglePlayerView: vi.fn(() => 'practice'),
}));

vi.mock('@/fronted/features/player/components/PlayerActions', () => ({
    playerActions: { pause: vi.fn() },
}));

const sentence = {
    fileHash: 'subtitle-1',
    index: 2,
    text: 'The journey rewards serendipity.',
} as Sentence;

const duePack = (): ContextPackVO => ({
    sentenceHash: 'sentence-hash',
    fileHash: 'subtitle-1',
    sentenceIndex: 2,
    vocabularyRevision: 0,
    guidance: 'coach',
    tokens: [],
    contentWords: 3,
    candidates: [{
        word: 'journey',
        surface: 'journey',
        phonetic: '/ˈdʒɜːni/',
        meaning: '旅程',
        tags: ['cet4'],
        isUserWord: true,
        status: 'learning',
        mastery: 0.3,
        confidence: 0.5,
        dueAt: new Date(Date.now() - 60_000).toISOString(),
        score: 0.72,
        reasons: ['due_now', 'learning'],
        order: 1,
    }],
    suggestion: null,
    density: { active: 0, max: 1 },
});

const mockSWR = (data: ContextPackVO) => {
    vi.mocked(useSWR).mockReturnValue({
        data,
        error: null,
        isLoading: false,
        mutate: vi.fn(),
    } as unknown as ReturnType<typeof useSWR>);
};

const renderHints = () => render(<SubtitleLearningHints sentence={sentence} />);

describe('SubtitleLearningHints', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        window.localStorage.clear();
        usePlaybackSession.setState({
            videoId: 'video-1',
            srtHash: 'subtitle-1',
        });
        useSetting.setState({
            values: new Map([['player.vocabularyGuidance', 'coach']]),
        });
        mockSWR(duePack());
        vi.mocked(videoLearningApi.rateReview).mockResolvedValue({
            card: {
                word: 'journey',
                schedule: { dueAt: '2026-11-20T00:00:00.000Z' },
            },
        } as never);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('暂停停留足够久且当前句有到期词时切换到微回忆', () => {
        renderHints();
        expect(screen.getByTestId('context-suggestion-stub')).toBeDefined();

        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        expect(screen.getByTestId('learning-moment')).toBeDefined();
        expect(screen.queryByTestId('context-suggestion-stub')).toBeNull();
    });

    it('安静模式不出现微回忆', () => {
        useSetting.setState({
            values: new Map([['player.vocabularyGuidance', 'calm']]),
        });
        renderHints();

        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        expect(screen.queryByTestId('learning-moment')).toBeNull();
        expect(screen.getByTestId('context-suggestion-stub')).toBeDefined();
    });

    it('同句冷却期间不重复出现', () => {
        window.localStorage.setItem('refrain:learning-moment:v1', JSON.stringify({
            at: Date.now(),
            sentenceHash: 'subtitle-1:2',
            sessionKey: 'session-1',
            count: 1,
        }));
        renderHints();

        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        expect(screen.queryByTestId('learning-moment')).toBeNull();
    });

    it('单次会话达到上限后不再出现', () => {
        window.localStorage.setItem('refrain:learning-moment:v1', JSON.stringify({
            at: Date.now() - 10 * 60_000,
            sentenceHash: 'another-sentence',
            sessionKey: 'session-1',
            count: 3,
        }));
        renderHints();

        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        expect(screen.queryByTestId('learning-moment')).toBeNull();
    });

    /**
     * §6.4「强化：更积极的复习和口语任务」。强化档在揭示释义后多一个
     * 「跟读这句」，直接复用练习台；教练档不出现，避免日常观看被打断。
     */
    it('强化档揭示后可以进入跟读，并暂停原声', () => {
        useSetting.setState({
            values: new Map([['player.vocabularyGuidance', 'intensive']]),
        });
        renderHints();
        act(() => {
            vi.advanceTimersByTime(2_000);
        });

        fireEvent.click(screen.getByTestId('learning-moment'));
        fireEvent.click(screen.getByTestId('learning-moment-reveal'));
        fireEvent.click(screen.getByTestId('learning-moment-shadowing'));

        expect(togglePlayerView).toHaveBeenCalledWith('practice');
        expect(playerActions.pause).toHaveBeenCalledTimes(1);
    });

    it('教练档不提供口语入口', () => {
        renderHints();
        act(() => {
            vi.advanceTimersByTime(5_000);
        });

        fireEvent.click(screen.getByTestId('learning-moment'));
        fireEvent.click(screen.getByTestId('learning-moment-reveal'));

        expect(screen.queryByTestId('learning-moment-shadowing')).toBeNull();
    });

    it('想起来了会提交 good 复习并写入限频记忆', async () => {
        renderHints();
        act(() => {
            vi.advanceTimersByTime(5_000);
        });
        vi.useRealTimers();

        fireEvent.click(screen.getByTestId('learning-moment'));
        fireEvent.click(screen.getByTestId('learning-moment-reveal'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('learning-moment-remembered'));
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(videoLearningApi.rateReview).toHaveBeenCalledWith(
                'journey',
                'good',
                { videoId: 'video-1', fileHash: 'subtitle-1' },
            );
        });
        expect(screen.queryByTestId('learning-moment')).toBeNull();
        const memory = JSON.parse(
            window.localStorage.getItem('refrain:learning-moment:v1') ?? '{}',
        ) as { sentenceHash?: string; count?: number };
        expect(memory.sentenceHash).toBe('subtitle-1:2');
        expect(memory.count).toBe(1);
    });
});
