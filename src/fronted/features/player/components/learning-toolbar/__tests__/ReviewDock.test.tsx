import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import useSWR from 'swr';

import ReviewDock from '../ReviewDock';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import type { ReviewQueueVO } from '@/common/types/review';
import { useReviewDockStore } from '../reviewDockStore';
import { usePlayer } from '@/fronted/features/player/playerStore';

vi.mock('swr', () => ({
    default: vi.fn(),
    mutate: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key,
            i18n: { language: 'zh-CN' },
        }),
    };
});

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        getReviewQueue: vi.fn(),
        rateReview: vi.fn(),
    },
}));

const queue: ReviewQueueVO = {
    items: [{
        id: 1,
        word: 'journey',
        translate: '旅程',
        status: 'learning',
        mastery: 0.42,
        confidence: 0.3,
        schedule: {
            dueAt: '2026-01-01T00:00:00.000Z',
            state: 'new',
            reps: 0,
            lapses: 0,
            stability: 0,
            difficulty: 0,
            lastReviewAt: null,
            lastRating: null,
        },
        context: {
            text: 'The journey changed everything.',
            videoId: 'video-1',
            videoFileName: 'lesson.mp4',
            sentenceIndex: 4,
            sentenceHash: 'sentence-4',
            lastSeenAt: '2026-01-01T00:00:00.000Z',
        },
    }],
    dueCount: 1,
    nextDueAt: '2026-01-01T00:00:00.000Z',
    stats: {
        last7Days: { reviewed: 3, retention: 2 / 3 },
        last30Days: { reviewed: 8, retention: 0.75 },
    },
};

const mockSWR = (data?: ReviewQueueVO, options: { error?: Error; isLoading?: boolean } = {}) => {
    const mutate = vi.fn(async () => undefined);
    vi.mocked(useSWR).mockReturnValue({
        data,
        error: options.error ?? null,
        isLoading: options.isLoading ?? false,
        mutate,
    } as unknown as ReturnType<typeof useSWR>);
    return mutate;
};

describe('ReviewDock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('先展示单词，揭示后才显示释义与四档反馈', () => {
        mockSWR(queue);
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('review-dock-trigger'));

        expect(screen.getByTestId('review-card-word').textContent).toBe('journey');
        expect(screen.queryByText('旅程')).toBeNull();
        fireEvent.click(screen.getByTestId('review-reveal'));

        expect(screen.getByText('旅程')).toBeDefined();
        expect(screen.getByTestId('review-rating-again')).toBeDefined();
        expect(screen.getByTestId('review-rating-hard')).toBeDefined();
        expect(screen.getByTestId('review-rating-good')).toBeDefined();
        expect(screen.getByTestId('review-rating-easy')).toBeDefined();
    });

    it('揭示后展示遇见这个词的原句与来源视频', () => {
        mockSWR(queue);
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('review-dock-trigger'));
        expect(screen.queryByTestId('review-card-context')).toBeNull();

        fireEvent.click(screen.getByTestId('review-reveal'));

        const context = screen.getByTestId('review-card-context');
        expect(context.textContent).toContain('The journey changed everything.');
        // 该测试的 i18n mock 只返回 key，来源信息断言到 key 即可验证已渲染。
        expect(context.textContent).toContain('reviewDock.sourceVideo');
        expect(context.textContent).toContain('reviewDock.sourceSentence');
    });

    it('打开复习坞时记住播放位置，可一键回到该位置', () => {
        mockSWR(queue);
        const seekToTarget = vi.fn();
        usePlayer.setState({ seekToTarget } as never);
        const getExactPlayTime = vi.fn(() => 42.5);
        usePlayer.setState({ getExactPlayTime } as never);
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('review-dock-trigger'));
        fireEvent.click(screen.getByTestId('review-dock-return'));

        expect(getExactPlayTime).toHaveBeenCalled();
        expect(seekToTarget).toHaveBeenCalledWith({ time: 42.5 });
    });

    it('未打开过复习坞时不展示回到播放位置', () => {
        mockSWR(queue);
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        expect(screen.queryByTestId('review-dock-return')).toBeNull();
    });

    it('提交反馈后调用评分接口并刷新队列', async () => {
        const mutate = mockSWR(queue);
        vi.mocked(videoLearningApi.rateReview).mockResolvedValue({
            card: {
                ...queue.items[0],
                schedule: {
                    ...queue.items[0].schedule,
                    state: 'learning',
                    reps: 1,
                    dueAt: '2026-01-02T00:00:00.000Z',
                    lastRating: 'good',
                },
            },
            status: 'learning',
        });
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('review-dock-trigger'));
        fireEvent.click(screen.getByTestId('review-reveal'));
        fireEvent.click(screen.getByTestId('review-rating-good'));

        await waitFor(() => {
            expect(videoLearningApi.rateReview).toHaveBeenCalledWith('journey', 'good', {
                videoId: undefined,
                fileHash: undefined,
            });
        });
        await waitFor(() => {
            expect(mutate).toHaveBeenCalled();
        });
    });

    it('没有到期词时显示下一次复习时间而不是空卡', () => {
        mockSWR({
            ...queue,
            items: [],
            dueCount: 0,
            nextDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('review-dock-trigger'));

        expect(screen.getByText('reviewDock.emptyTitle')).toBeDefined();
        expect(screen.getByText('reviewDock.nextDue')).toBeDefined();
    });

    it('加载失败时提供重试入口', () => {
        mockSWR(undefined, { error: new Error('db failed') });
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('review-dock-trigger'));

        expect(screen.getByText('reviewDock.loadFailed')).toBeDefined();
        expect(screen.getByRole('button', { name: /reviewDock.retry/i })).toBeDefined();
    });

    it('消费首页的打开请求并展示复习面板', async () => {
        mockSWR(queue);
        useReviewDockStore.setState({ requestId: 1, consumedId: 0 });
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        expect(await screen.findByTestId('review-dock-panel')).toBeDefined();
        fireEvent.click(screen.getByTestId('review-dock-trigger'));
        await waitFor(() => expect(useReviewDockStore.getState().consumedId).toBe(1));
    });
});
