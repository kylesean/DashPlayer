import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useSWR from 'swr';

import MemoryMapSection from '../MemoryMapSection';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import type { MemoryMapVO } from '@/common/types/memoryMap';

vi.mock('swr', () => ({
    default: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => {
            if (options && 'count' in options) return `${key}:${options.count}`;
            if (options && 'total' in options) return `${key}:${options.total}`;
            return key;
        },
    }),
}));

vi.mock('@/fronted/features/learning-data/learningDataApi', () => ({
    learningDataApi: {
        getMemoryMap: vi.fn(),
    },
}));

const map: MemoryMapVO = {
    generatedAt: '2026-01-01T10:00:00.000Z',
    totalWords: 4,
    activeWords: 2,
    topics: [
        {
            key: 'video:1',
            label: 'A Long Journey',
            wordCount: 3,
            counts: { learning: 2, familiar: 0, known: 1, ignored: 0 },
            words: [
                { word: 'journey', translate: '旅程', status: 'learning', mastery: 0.3, encounters: 2, due: true, lastSeenAt: '2026-01-01T10:00:00.000Z', context: 'It was a long journey home.' },
                { word: 'orbit', translate: '轨道', status: 'known', mastery: 1, encounters: 1, due: false, lastSeenAt: '2026-01-01T09:00:00.000Z', context: null },
            ],
        },
    ],
    looseWords: {
        key: 'loose',
        label: null,
        wordCount: 1,
        counts: { learning: 0, familiar: 1, known: 0, ignored: 0 },
        words: [
            { word: 'manual', translate: '手册', status: 'familiar', mastery: 0.6, encounters: 0, due: false, lastSeenAt: '2026-01-01T08:00:00.000Z', context: null },
        ],
    },
};

describe('MemoryMapSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useSWR).mockReturnValue({
            data: map,
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
        } as never);
    });

    it('默认折叠，展开后按主题展示词与阶段', async () => {
        vi.mocked(learningDataApi.getMemoryMap).mockResolvedValue(map);
        vi.mocked(useSWR).mockReturnValue({
            data: map,
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
        } as never);
        render(<MemoryMapSection onSelectWord={() => undefined} />);

        expect(await screen.findByText('title')).toBeDefined();
        expect(screen.getByText('summary:4')).toBeDefined();
        expect(screen.queryByText('A Long Journey')).toBeNull();

        fireEvent.click(screen.getByText('expand'));

        expect(screen.getByText('A Long Journey')).toBeDefined();
        expect(screen.getByText('journey')).toBeDefined();
        expect(screen.getByText('orbit')).toBeDefined();
        expect(screen.getByText('looseTitle')).toBeDefined();
        expect(screen.getByText('manual')).toBeDefined();
    });

    it('点击主题词时回传词条', async () => {
        const onSelectWord = vi.fn();
        vi.mocked(useSWR).mockReturnValue({
            data: map,
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
        } as never);
        render(<MemoryMapSection onSelectWord={onSelectWord} />);

        fireEvent.click(await screen.findByText('expand'));
        fireEvent.click(screen.getByText('journey'));

        expect(onSelectWord).toHaveBeenCalledWith('journey');
    });

    it('没有用户词时整段隐藏', async () => {
        vi.mocked(useSWR).mockReturnValue({
            data: { ...map, totalWords: 0, topics: [], looseWords: null },
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
        } as never);
        const { container } = render(<MemoryMapSection onSelectWord={() => undefined} />);

        await waitFor(() => expect(container.textContent).toBe(''));
    });

    it('独立画布模式默认直接展开且隐藏折叠按钮，并不重复关键词副标题', () => {
        vi.mocked(useSWR).mockReturnValue({
            data: {
                ...map,
                topics: [
                    {
                        key: 'cluster:1',
                        label: null,
                        keywords: ['aware', 'couple'],
                        wordCount: 2,
                        counts: { learning: 2, familiar: 0, known: 0, ignored: 0 },
                        words: map.topics[0].words,
                    },
                ],
            },
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
        } as never);

        render(<MemoryMapSection defaultExpanded hideCollapseToggle onSelectWord={() => undefined} />);

        expect(screen.queryByText('expand')).toBeNull();
        expect(screen.queryByText('collapse')).toBeNull();
        expect(screen.getByText('keywordTopic')).toBeDefined();
        expect(screen.queryByText('topicKeywords')).toBeNull();
        expect(screen.getByText('looseTitle')).toBeDefined();
    });

    it('渲染 FSRS 遗忘曲线图表并支持触发专题复习启动器', () => {
        const onLaunchTopicReview = vi.fn();
        vi.mocked(useSWR).mockReturnValue({
            data: {
                ...map,
                topics: [
                    {
                        ...map.topics[0],
                        dueCount: 1,
                        healthScore: 68,
                        reviewWords: ['orbit', 'journey'],
                    },
                ],
                memoryHealth: {
                    retrievabilityBuckets: { fragile: 1, consolidating: 1, mastered: 0 },
                    leechCount: 0,
                    avgStabilityDays: 6.5,
                    forecastDays: Array.from({ length: 14 }, (_, idx) => ({
                        date: `2026-01-${String(idx + 1).padStart(2, '0')}`,
                        dueCount: idx === 0 ? 1 : 0,
                    })),
                    decayCurve: [
                        { day: 0, retention: 1 },
                        { day: 7, retention: 0.78 },
                        { day: 30, retention: 0.52 },
                    ],
                },
            },
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
        } as never);

        render(
            <MemoryMapSection
                defaultExpanded
                hideCollapseToggle
                onSelectWord={() => undefined}
                onLaunchTopicReview={onLaunchTopicReview}
            />,
        );

        expect(screen.getByText('forgettingCurveTitle')).toBeDefined();
        expect(screen.getByText('forecastTitle')).toBeDefined();
        const launchBtn = screen.getByRole('button', { name: 'launchTopicReview:2' });
        fireEvent.click(launchBtn);
        expect(onLaunchTopicReview).toHaveBeenCalledWith(['orbit', 'journey'], 'A Long Journey');
    });
});
