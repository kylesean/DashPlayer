import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContextStudioPage from '../ContextStudioPage';

const mockGetVocabulary = vi.fn();
const mockGetReviewQueue = vi.fn();
const mockGetWordMemory = vi.fn();
const mockListSavedSentences = vi.fn();
const mockGetWordContexts = vi.fn();
const mockUpdateSavedSentence = vi.fn();

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        getVocabulary: (...args: unknown[]) => mockGetVocabulary(...args),
        getReviewQueue: (...args: unknown[]) => mockGetReviewQueue(...args),
        getWordMemory: (...args: unknown[]) => mockGetWordMemory(...args),
        updateWordState: vi.fn().mockResolvedValue({ success: true }),
        deleteWord: vi.fn().mockResolvedValue({ success: true }),
        generateDefinition: vi.fn().mockResolvedValue({ success: true, data: 'AI 释义' }),
        rateReview: vi.fn().mockResolvedValue({}),
        exportVocabularyTemplate: vi.fn().mockResolvedValue({ success: true, data: '' }),
        importVocabulary: vi.fn().mockResolvedValue({ success: true }),
    },
}));

vi.mock('../contextStudioApi', () => ({
    contextStudioApi: {
        listSavedSentences: (...args: unknown[]) => mockListSavedSentences(...args),
        getWordContexts: (...args: unknown[]) => mockGetWordContexts(...args),
        updateSavedSentence: (...args: unknown[]) => mockUpdateSavedSentence(...args),
        unsaveSentence: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('@/fronted/features/learning-data/MemoryMapSection', () => ({
    default: () => <div data-testid="mock-memory-map" />,
}));

vi.mock('@/fronted/features/video-learning/components/WordEditDialog', () => ({
    default: () => null,
}));

describe('ContextStudioPage - Three-column workspace (Words & Sentences)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVocabulary.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    word: 'serendipity',
                    translate: 'n. 机缘巧合',
                    status: 'learning',
                    created_at: '2026-11-12T00:00:00Z',
                    updated_at: '2026-11-12T00:00:00Z',
                },
            ],
        });
        mockGetReviewQueue.mockResolvedValue({
            items: [{ id: 1, word: 'serendipity' }],
            dueCount: 1,
            nextDueAt: null,
            stats: { last7Days: { reviewed: 0, retention: null }, last30Days: { reviewed: 0, retention: null } },
        });
        mockListSavedSentences.mockResolvedValue([
            {
                id: 10,
                sentenceKey: 'hash-1:12',
                videoId: 'vid-1',
                videoTitle: 'Steve Jobs Stanford',
                fileHash: 'hash-1',
                sentenceIndex: 12,
                startTime: 45,
                endTime: 50,
                text: 'Stay hungry, stay foolish.',
                textZh: '求知若饥，虚心若愚。',
                note: '经典结语',
                tag: 'expression',
                createdAt: '2026-11-12T00:00:00Z',
                updatedAt: '2026-11-12T00:00:00Z',
            },
        ]);
        mockGetWordContexts.mockResolvedValue([
            {
                id: 'enc-1',
                videoId: 'vid-2',
                videoTitle: 'TED Talk',
                context: 'It was pure serendipity.',
                contextZh: '这纯粹是机缘巧合。',
                createdAt: '2026-11-12T00:00:00Z',
                source: 'encounter',
            },
        ]);
        mockGetWordMemory.mockResolvedValue(null);
    });

    it('renders both word and sentence assets and switches detail canvas cleanly', async () => {
        render(
            <MemoryRouter>
                <ContextStudioPage />
            </MemoryRouter>,
        );

        // 等待加载完成，默认选中第一个生词 serendipity 及其真实语境
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'serendipity' })).toBeDefined();
        });
        expect(mockGetReviewQueue).toHaveBeenCalledWith(50);
        await waitFor(() => {
            expect(screen.getByText('It was pure serendipity.')).toBeDefined();
        });

        // 点击中栏的金句卡片，右侧切换为金句详情画布
        const sentenceCard = screen.getByText('Stay hungry, stay foolish.');
        fireEvent.click(sentenceCard);

        await waitFor(() => {
            expect(screen.getByDisplayValue('经典结语')).toBeDefined();
            expect(screen.getAllByText('Steve Jobs Stanford').length).toBeGreaterThanOrEqual(2);
        });
    });

    it('filters list between words and sentences via left navigation', async () => {
        render(
            <MemoryRouter>
                <ContextStudioPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'serendipity' })).toBeDefined();
        });

        // 点击左侧「收藏金句」过滤
        const sentenceFilterBtn = screen.getByRole('button', { name: /收藏金句/i });
        fireEvent.click(sentenceFilterBtn);

        expect(screen.queryByRole('button', { name: /serendipity/i })).toBeNull();
        expect(screen.getByText('Stay hungry, stay foolish.')).toBeDefined();
    });

    it('switches primary canvas between workspace and full-height memory map', async () => {
        render(
            <MemoryRouter>
                <ContextStudioPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'serendipity' })).toBeDefined();
        });

        const mapTab = screen.getByRole('radio', { name: /记忆图谱/i });
        fireEvent.click(mapTab);

        expect(screen.getByTestId('mock-memory-map')).toBeDefined();
        expect(screen.queryByRole('heading', { name: 'serendipity' })).toBeNull();

        const workspaceTab = screen.getByRole('radio', { name: /工作台/i });
        fireEvent.click(workspaceTab);

        expect(screen.getByRole('heading', { name: 'serendipity' })).toBeDefined();
    });
});
