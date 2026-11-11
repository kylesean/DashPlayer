import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ContentCompassSection from '../ContentCompassSection';
import { contentCompassApi } from '@/fronted/features/content-compass/contentCompassApi';
import type { ContentCompassVO } from '@/common/types/contentCompass';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('@/fronted/features/content-compass/contentCompassApi', () => ({
    contentCompassApi: {
        list: vi.fn(),
        recordEvent: vi.fn(),
    },
}));

vi.mock('@/fronted/features/file-browser/fileBrowserApi', () => ({
    fileBrowserApi: {
        getThumbnail: vi.fn(),
    },
}));

const result: ContentCompassVO = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    items: [
        {
            videoId: 'video-1',
            fileName: 'A Quiet Journey.mp4',
            basePath: '/library',
            srtFile: '/library/A Quiet Journey.srt',
            currentPosition: 10,
            score: 0.82,
            comprehension: 0.78,
            comprehensionBand: 'medium',
            interest: 0.25,
            reason: {
                code: 'due_review',
                words: ['journey'],
                dueCount: 3,
                learningCount: 5,
            },
        },
        {
            videoId: 'video-2',
            fileName: 'Slow English.mp4',
            basePath: '/library',
            srtFile: '/library/Slow English.srt',
            currentPosition: 0,
            score: 0.7,
            comprehension: 0.84,
            comprehensionBand: 'high',
            interest: 0.1,
            reason: {
                code: 'interest_match',
                words: [],
                dueCount: 0,
                learningCount: 0,
            },
        },
    ],
};

describe('ContentCompassSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        vi.mocked(contentCompassApi.list).mockResolvedValue(result);
        vi.mocked(contentCompassApi.recordEvent).mockResolvedValue(undefined);
    });

    it('展示推荐依据并记录曝光', async () => {
        render(<ContentCompassSection onSelected={() => undefined} />);

        expect(await screen.findByText('title')).toBeDefined();
        expect(screen.getByText('A Quiet Journey')).toBeDefined();
        expect(screen.getByText('reasonDue')).toBeDefined();
        expect(screen.getAllByText('comprehension')).toHaveLength(2);
        await waitFor(() => {
            expect(contentCompassApi.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
                videoId: 'video-1',
                action: 'shown',
            }));
        });
    });

    it('点击卡片记录打开事件并导航', async () => {
        const onSelected = vi.fn();
        render(<ContentCompassSection onSelected={onSelected} />);

        const openButtons = await screen.findAllByRole('button', { name: 'open' });
        fireEvent.click(openButtons[0]);

        expect(onSelected).toHaveBeenCalledWith('video-1');
        expect(contentCompassApi.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
            videoId: 'video-1',
            action: 'opened',
        }));
    });

    it('不感兴趣后移除当前推荐并记录反馈', async () => {
        render(<ContentCompassSection onSelected={() => undefined} />);

        const dismissButtons = await screen.findAllByRole('button', { name: 'dismiss' });
        fireEvent.click(dismissButtons[0]);

        expect(screen.queryByText('A Quiet Journey')).toBeNull();
        expect(screen.getByText('Slow English')).toBeDefined();
        expect(contentCompassApi.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
            videoId: 'video-1',
            action: 'dismissed',
        }));
    });
});
