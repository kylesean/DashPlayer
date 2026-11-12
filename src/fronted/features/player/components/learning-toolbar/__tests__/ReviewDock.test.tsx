import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import useSWR from 'swr';

import ReviewDock from '../ReviewDock';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import type { ReviewQueueVO, ReviewRateResultVO } from '@/common/types/review';
import { useReviewDockStore } from '../reviewDockStore';
import { usePlayer } from '@/fronted/features/player/playerStore';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
}));

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
        getWordClipStats: vi.fn(),
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

    /**
     * 计划要求到期词「以 3–5 个为一组」：一组做完要给明确的收束与继续入口，
     * 而不是让用户面对一条看不到头的队列。
     */
    it('一组做完后给出收束文案与继续下一组的入口', async () => {
        const manyCards: ReviewQueueVO = {
            ...queue,
            dueCount: 7,
            items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((word, index) => ({
                ...queue.items[0],
                id: index + 1,
                word,
            })),
        };
        let current = manyCards;
        const mutate = vi.fn(async () => undefined);
        vi.mocked(useSWR).mockImplementation(() => ({
            data: current,
            error: null,
            isLoading: false,
            mutate,
        } as unknown as ReturnType<typeof useSWR>));
        vi.mocked(videoLearningApi.rateReview).mockImplementation(async (word) => {
            // 服务端评完就把该词移出到期列表，这里如实模拟。
            current = { ...current, items: current.items.filter((item) => item.word !== word) };
            return {
                card: { ...queue.items[0], word, schedule: { ...queue.items[0].schedule, state: 'learning' } },
                status: 'learning',
            };
        });

        render(<ReviewDock tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByTestId('review-dock-trigger'));

        expect(screen.getByTestId('review-batch-progress')).toBeDefined();

        for (let i = 0; i < 5; i += 1) {
            fireEvent.click(screen.getByTestId('review-reveal'));
            fireEvent.click(screen.getByTestId('review-rating-good'));
            await waitFor(() => expect(videoLearningApi.rateReview).toHaveBeenCalledTimes(i + 1));
        }

        expect(screen.getByTestId('review-batch-done')).toBeDefined();
        expect(screen.getByTestId('review-batch-next')).toBeDefined();

        fireEvent.click(screen.getByTestId('review-batch-next'));
        expect(screen.getByTestId('review-card-word').textContent).toBe('f');
    });

    it('深链打开同样记录返回点并展示返回按钮，关闭面板时丢弃在途评分结果', async () => {
        mockSWR(queue);
        usePlayer.setState({ currentTime: 18 } as never);
        useReviewDockStore.setState({ requestId: 2, consumedId: 0 });
        render(<ReviewDock tone="panel" popoverOffset={8} />);

        await screen.findByTestId('review-dock-panel');
        expect(await screen.findByTestId('review-dock-return')).toBeDefined();

        let resolveRate!: (res: ReviewRateResultVO) => void;
        vi.mocked(videoLearningApi.rateReview).mockImplementationOnce(
            () => new Promise((resolve) => {
                resolveRate = resolve;
            }),
        );
        fireEvent.click(screen.getByTestId('review-reveal'));
        fireEvent.click(screen.getByTestId('review-rating-good'));

        // 在 rateReview 尚未返回时关闭弹窗
        fireEvent.click(screen.getByTestId('review-dock-trigger'));

        resolveRate({
            card: { ...queue.items[0], schedule: { ...queue.items[0].schedule, dueAt: '2026-01-02T00:00:00.000Z' } },
            status: 'learning',
        });
        await Promise.resolve();

        // 再次打开应是全新的会话起点（不带上次被关闭那轮的 feedback / review-last-rated）
        fireEvent.click(screen.getByTestId('review-dock-trigger'));
        expect(screen.queryByTestId('review-last-rated')).toBeNull();
    });
});
