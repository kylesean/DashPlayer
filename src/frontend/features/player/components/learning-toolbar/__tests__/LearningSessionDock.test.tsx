import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import useSWR from 'swr';

import LearningSessionDock from '../LearningSessionDock';
import { usePlaybackSession } from '@/frontend/features/player/playbackSessionStore';
import { useLearningSessionStore } from '@/frontend/features/player/learningSessionStore';
import type { LearningSessionSummaryVO } from '@/common/types/learningSession';

vi.mock('swr', () => ({
    default: vi.fn(),
    mutate: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => key,
            i18n: { language: 'zh-CN' },
        }),
    };
});

vi.mock('../LearningRecapDialog', () => ({
    default: ({ open }: { open: boolean }) =>
        open ? <div data-testid="mock-learning-recap-dialog" /> : null,
}));

const summary: LearningSessionSummaryVO = {
    since: '2026-01-01T10:00:00.000Z',
    counts: {
        encountered: 3,
        mastered: 1,
        due: 1,
        practice: 2,
    },
    words: [
        {
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            mastery: 0.4,
            confidence: 0.5,
            actions: ['save', 'shadow'],
            lastSeenAt: '2026-01-01T10:10:00.000Z',
            dueAt: '2026-01-01T09:00:00.000Z',
        },
        {
            word: 'orbit',
            translate: '轨道',
            status: 'known',
            mastery: 1,
            confidence: 1,
            actions: ['known'],
            lastSeenAt: '2026-01-01T10:09:00.000Z',
            dueAt: null,
        },
    ],
    mastered: [],
    due: [],
    nextDueAt: null,
};

const mockSWR = (data?: LearningSessionSummaryVO) => {
    const mutate = vi.fn(async () => undefined);
    vi.mocked(useSWR).mockReturnValue({
        data,
        error: null,
        isLoading: false,
        mutate,
    } as unknown as ReturnType<typeof useSWR>);
    return mutate;
};

describe('LearningSessionDock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePlaybackSession.setState({ videoId: 'video-1', srtHash: 'hash-1' });
        useLearningSessionStore.setState({ key: null, since: null });
    });

    it('展示本次学习的统计、最近遇见词与状态徽标', () => {
        mockSWR(summary);
        render(<LearningSessionDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('learning-session-trigger'));

        expect(screen.getByText('learningSummary.title')).toBeDefined();
        expect(screen.getByText('learningSummary.encountered')).toBeDefined();
        expect(screen.getByText('journey')).toBeDefined();
        expect(screen.getByText('旅程')).toBeDefined();
        expect(screen.getByText('learningSummary.dueBadge')).toBeDefined();
        expect(screen.getByText('learningSummary.masteredBadge')).toBeDefined();
    });

    it('没有学习记录时显示空状态', () => {
        mockSWR({
            ...summary,
            counts: { encountered: 0, mastered: 0, due: 0, practice: 0 },
            words: [],
        });
        render(<LearningSessionDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('learning-session-trigger'));

        expect(screen.getByText('learningSummary.emptyTitle')).toBeDefined();
        expect(screen.getByText('learningSummary.emptyHint')).toBeDefined();
    });

    it('有学习记录时可以从摘要入口打开学习复盘', () => {
        mockSWR(summary);
        useLearningSessionStore.setState({
            key: 'video-1::hash-1',
            since: '2026-01-01T10:00:00.000Z',
        });
        render(<LearningSessionDock tone="panel" popoverOffset={8} />);

        fireEvent.click(screen.getByTestId('learning-session-trigger'));
        fireEvent.click(screen.getByTestId('learning-recap-trigger'));

        expect(screen.getByTestId('mock-learning-recap-dialog')).toBeDefined();
    });
});
