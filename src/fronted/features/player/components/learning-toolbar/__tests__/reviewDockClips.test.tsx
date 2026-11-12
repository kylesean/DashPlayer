import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import ReviewDock from '../ReviewDock';
import type { ReviewCardVO } from '@/common/types/review';

const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
    useNavigate: () => navigate,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => (
            options && 'count' in options ? `${key}:${String(options.count)}` : key
        ),
        i18n: { language: 'zh-CN' },
    }),
}));

const card: ReviewCardVO = {
    id: 1,
    word: 'journey',
    translate: '旅程',
    status: 'learning',
    mastery: 0.3,
    confidence: 0.6,
    schedule: {
        dueAt: '2026-11-01T00:00:00.000Z',
        state: 'review',
        reps: 2,
        lapses: 0,
        stability: 3,
        difficulty: 5,
        lastReviewAt: null,
        lastRating: null,
    },
    context: null,
};

vi.mock('@astryxdesign/core/Popover', () => ({
    usePopover: () => ({
        isOpen: true,
        triggerRef: { current: null },
        triggerProps: {},
        render: (content: React.ReactNode) => <div>{content}</div>,
        show: vi.fn(),
        hide: vi.fn(),
        toggle: vi.fn(),
    }),
}));

vi.mock('@astryxdesign/core/Tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('swr', () => ({
    default: (key: unknown) => {
        if (key === 'video-learning/word-clip-stats') {
            return { data: { success: true, data: { journey: { count: 3, lastAddedAt: '' } } } };
        }
        return {
            data: {
                items: [card],
                dueCount: 1,
                nextDueAt: null,
                stats: {
                    last7Days: { reviewed: 0, retention: null },
                    last30Days: { reviewed: 0, retention: null },
                },
            },
            error: null,
            isLoading: false,
            mutate: vi.fn(),
        };
    },
}));

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        getReviewQueue: vi.fn(),
        getWordClipStats: vi.fn(),
        rateReview: vi.fn(),
    },
}));

vi.mock('@/fronted/features/player/playbackSessionStore', () => ({
    usePlaybackSession: () => ({ videoId: null, srtHash: null }),
}));

vi.mock('@/fronted/features/player/playerStore', () => ({
    usePlayer: { getState: () => ({ getExactPlayTime: () => 0, seekToTarget: vi.fn() }) },
}));

vi.mock('../reviewDockStore', () => ({
    useReviewDockStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
        requestId: 0,
        consumedId: 0,
        consume: vi.fn(),
    }),
}));

vi.mock('../toolbarStyles', () => ({
    TOOLBAR_ICON_BUTTON: '',
    TOOLBAR_TONE: { idle: '', active: '' },
}));

describe('ReviewDock 片段入口', () => {
    /**
     * 片段此前完全不参与复习闭环。揭示释义后给出「看 N 个片段」，
     * 把复习从「认词」推回「回到真实语境再听一遍」。
     */
    it('该词有片段时给出入口，点击进入词表并按词筛选', () => {
        render(<ReviewDock tone="idle" popoverOffset={0} />);

        // 入口只在揭示之后出现：还没想起词义就先去看视频，等于跳过回忆这一步。
        expect(screen.queryByTestId('review-open-clips')).toBeNull();
        fireEvent.click(screen.getByTestId('review-reveal'));

        const entry = screen.getByTestId('review-open-clips');
        expect(entry.textContent).toContain('reviewDock.openClips:3');

        fireEvent.click(entry);
        expect(navigate).toHaveBeenCalledWith('/vocabulary?word=journey');
    });
});
