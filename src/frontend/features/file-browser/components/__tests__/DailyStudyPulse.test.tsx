import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DailyStudyPulse } from '../DailyStudyPulse';

const mockGetReviewQueue = vi.fn();
const mockListReaderDocuments = vi.fn();
const mockGetLatestSavedReaderProgress = vi.fn();

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
    }),
}));

vi.mock('@/frontend/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        getReviewQueue: (...args: unknown[]) => mockGetReviewQueue(...args),
    },
}));

vi.mock('@/frontend/features/context-studio/contextStudioApi', () => ({
    contextStudioApi: {
        listReaderDocuments: (...args: unknown[]) => mockListReaderDocuments(...args),
    },
}));

vi.mock('@/frontend/features/script-reader/lib/readerProgress', () => ({
    getLatestSavedReaderProgress: () => mockGetLatestSavedReaderProgress(),
}));

function LocationProbe() {
    const loc = useLocation();
    return <div data-testid="location-probe">{`${loc.pathname}${loc.search}`}</div>;
}

describe('DailyStudyPulse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetLatestSavedReaderProgress.mockReturnValue(null);
    });

    it('无待复习且无精读文稿时不渲染任何内容', async () => {
        mockGetReviewQueue.mockResolvedValue({ dueCount: 0, items: [] });
        mockListReaderDocuments.mockResolvedValue([]);

        const { container } = render(
            <MemoryRouter>
                <DailyStudyPulse />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(mockGetReviewQueue).toHaveBeenCalled();
        });
        expect(container.querySelector('[data-testid="daily-study-pulse"]')).toBeNull();
    });

    it('存在待复习与最近精读时展示入口并正确导航', async () => {
        mockGetReviewQueue.mockResolvedValue({ dueCount: 5, items: [] });
        mockListReaderDocuments.mockResolvedValue([{ videoId: 'vid-9', title: 'Stanford Talk' }]);
        mockGetLatestSavedReaderProgress.mockReturnValue({ videoId: 'vid-9', sentenceIndex: 12 });

        render(
            <MemoryRouter>
                <LocationProbe />
                <DailyStudyPulse />
            </MemoryRouter>,
        );

        const pulse = await screen.findByTestId('daily-study-pulse');
        expect(pulse.textContent).toContain('今日待复习 5 词');
        expect(pulse.textContent).toContain('Stanford Talk');

        fireEvent.click(screen.getByRole('button', { name: '进入今日训练' }));
        expect(screen.getByTestId('location-probe').textContent).toBe('/context-studio?view=review');
    });
});
