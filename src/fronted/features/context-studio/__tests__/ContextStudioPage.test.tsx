import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ContextStudioPage from '../ContextStudioPage';

const mockGetVocabulary = vi.fn();
const mockGetReviewQueue = vi.fn();
const mockGetWordMemory = vi.fn();
const mockRateReview = vi.fn();
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
        rateReview: (...args: unknown[]) => mockRateReview(...args),
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
            items: [
                {
                    id: 1,
                    word: 'serendipity',
                    translate: 'n. 机缘巧合',
                    status: 'learning',
                    mastery: 0.2,
                    confidence: 0.5,
                    schedule: {
                        dueAt: '2026-11-12T00:00:00Z',
                        state: 'learning',
                        reps: 1,
                        lapses: 0,
                        stability: 1.5,
                        difficulty: 5,
                        lastReviewAt: null,
                        lastRating: null,
                    },
                    context: null,
                },
            ],
            dueCount: 1,
            nextDueAt: null,
            stats: { last7Days: { reviewed: 0, retention: null }, last30Days: { reviewed: 0, retention: null } },
        });
        mockRateReview.mockResolvedValue({
            card: { id: 1, word: 'serendipity' },
            status: 'familiar',
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
            {
                id: 11,
                sentenceKey: 'hash-1:20',
                videoId: 'vid-1',
                videoTitle: 'Steve Jobs Stanford',
                fileHash: 'hash-1',
                sentenceIndex: 20,
                startTime: 80,
                endTime: 85,
                text: 'Connecting the dots looking backwards.',
                textZh: '回顾往昔，串联点滴。',
                note: '',
                tag: 'grammar',
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
            expect(
                screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'It was pure serendipity.'),
            ).toBeDefined();
        });

        // 点击中栏的金句卡片，右侧切换为金句详情画布
        const sentenceCard = screen.getByText('Stay hungry, stay foolish.');
        fireEvent.click(sentenceCard);

        await waitFor(() => {
            expect(screen.getByDisplayValue('经典结语')).toBeDefined();
            expect(screen.getAllByText('Steve Jobs Stanford').length).toBeGreaterThanOrEqual(2);
        });
    });

    it('filters list between words and sentences via left navigation and filters sentences by tag', async () => {
        function LocationProbe() {
            const loc = useLocation();
            return <div data-testid="location-probe">{`${loc.pathname}${loc.search}`}</div>;
        }

        render(
            <MemoryRouter>
                <LocationProbe />
                <ContextStudioPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'serendipity' })).toBeDefined();
        });

        // 点击左侧「收藏金句」过滤，左侧次级菜单切换为金句标签筛选与顺序连播
        const sentenceFilterBtn = screen.getByRole('button', { name: /收藏金句/i });
        fireEvent.click(sentenceFilterBtn);

        expect(screen.queryByRole('button', { name: /serendipity/i })).toBeNull();
        expect(screen.getByText('Stay hungry, stay foolish.')).toBeDefined();
        expect(screen.getByText('Connecting the dots looking backwards.')).toBeDefined();
        expect(screen.getByRole('button', { name: /顺序连播/i })).toBeDefined();

        // 按标签过滤为长难句（grammar）
        const sidebar = document.querySelector('aside') as HTMLElement;
        const grammarTagBtn = within(sidebar).getByRole('button', { name: /长难句/i });
        fireEvent.click(grammarTagBtn);

        expect(screen.queryByText('Stay hungry, stay foolish.')).toBeNull();
        expect(screen.getByText('Connecting the dots looking backwards.')).toBeDefined();

        // 点击「精读全文」验证深链跳转参数
        const openReaderBtn = screen.getByRole('button', { name: /精读全文/i });
        fireEvent.click(openReaderBtn);
        expect(screen.getByTestId('location-probe').textContent).toBe('/reader/vid-1?sentence=20');
    });

    it('runs P0 active recall review session from header CTA and schedules rating', async () => {
        render(
            <MemoryRouter>
                <ContextStudioPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'serendipity' })).toBeDefined();
        });

        const startReviewTab = screen.getByRole('radio', { name: /今日训练 \(1\)/i });
        fireEvent.click(startReviewTab);

        // 等待语境加载并确认释义处于遮罩回忆阶段
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /显示答案/i })).toBeDefined();
        });
        expect(screen.queryByText('n. 机缘巧合')).toBeNull();

        // 点击显示答案，出现词义与四档评分按钮
        fireEvent.click(screen.getByRole('button', { name: /显示答案/i }));
        expect(screen.getByText('n. 机缘巧合')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: /想起来了/i }));

        await waitFor(() => {
            expect(mockRateReview).toHaveBeenCalledWith('serendipity', 'good', { videoId: 'vid-2' });
        });
        await waitFor(() => {
            expect(screen.getByText('本轮语境复习已完成')).toBeDefined();
        });
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

        const mapTab = screen.getByRole('radio', { name: /记忆全景/i });
        fireEvent.click(mapTab);

        expect(screen.getByTestId('mock-memory-map')).toBeDefined();
        expect(screen.queryByRole('heading', { name: 'serendipity' })).toBeNull();

        const workspaceTab = screen.getByRole('radio', { name: /语境资产/i });
        fireEvent.click(workspaceTab);

        expect(screen.getByRole('heading', { name: 'serendipity' })).toBeDefined();
    });

    it('opens memory panorama directly via ?view=memory deep link', async () => {
        render(
            <MemoryRouter initialEntries={['/context-studio?view=memory']}>
                <ContextStudioPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('mock-memory-map')).toBeDefined();
        });
    });
});
