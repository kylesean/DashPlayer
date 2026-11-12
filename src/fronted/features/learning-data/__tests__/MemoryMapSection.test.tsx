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

    it('切换到关系图后按共现关系画节点，点击节点仍回传词条', async () => {
        const onSelectWord = vi.fn();
        vi.mocked(useSWR).mockReturnValue({
            data: {
                ...map,
                topics: [{
                    ...map.topics[0],
                    words: [
                        { ...map.topics[0].words[0], neighbors: [{ word: 'orbit', weight: 3 }] },
                        { ...map.topics[0].words[1], neighbors: [{ word: 'journey', weight: 3 }] },
                    ],
                }],
            },
            error: undefined,
            isLoading: false,
            mutate: vi.fn(),
        } as never);
        render(<MemoryMapSection onSelectWord={onSelectWord} />);

        fireEvent.click(await screen.findByText('expand'));
        fireEvent.click(screen.getByText('viewGraph'));

        // 关系图是交互容器：必须用 group 而非 img，否则内部按钮在无障碍树中被当作图像内容隐藏。
        expect(screen.getByRole('group', { name: 'graphLabel' })).toBeDefined();
        expect(screen.getByText('graphHint')).toBeDefined();
        // 关系图里每条无向边只画一次。
        expect(document.querySelectorAll('svg line')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'journey' }));
        expect(onSelectWord).toHaveBeenCalledWith('journey');
    });
});
