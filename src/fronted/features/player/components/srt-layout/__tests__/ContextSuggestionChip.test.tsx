import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import useSWR from 'swr';

import ContextSuggestionChip from '../ContextSuggestionChip';
import useSetting from '@/fronted/features/settings/settingsStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { useVocabularyStore } from '@/fronted/features/player/vocabularyStore';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import type { ContextPackVO } from '@/common/types/contextPack';
import type { Sentence } from '@/common/types/SentenceC';

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
        }),
    };
});

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        contextPack: vi.fn(),
        favoriteWord: vi.fn(),
        updateWordState: vi.fn(),
        recordWordEncounter: vi.fn(),
    },
}));

const sentence = {
    fileHash: 'subtitle-1',
    index: 2,
    text: 'The journey rewards serendipity.',
} as Sentence;

const newWordPack: ContextPackVO = {
    sentenceHash: 'sentence-hash',
    fileHash: 'subtitle-1',
    sentenceIndex: 2,
    vocabularyRevision: 0,
    guidance: 'coach',
    tokens: [],
    contentWords: 3,
    candidates: [],
    suggestion: {
        word: 'journey',
        surface: 'journey',
        phonetic: '/journey/',
        meaning: '旅程',
        tags: ['cet4'],
        isUserWord: false,
        status: null,
        mastery: 0,
        confidence: 0,
        dueAt: null,
        score: 0.92,
        reasons: ['useful_new_word'],
        order: 1,
    },
    density: { active: 1, max: 1 },
};

const userWordPack: ContextPackVO = {
    ...newWordPack,
    suggestion: {
        ...newWordPack.suggestion!,
        isUserWord: true,
        status: 'learning',
        mastery: 0.2,
        confidence: 0.4,
        dueAt: '2026-01-01T00:00:00.000Z',
        reasons: ['due_now', 'learning'],
    },
};

const mockSWR = (data?: ContextPackVO) => {
    vi.mocked(useSWR).mockReturnValue({
        data,
        error: null,
        isLoading: false,
        mutate: vi.fn(),
    } as unknown as ReturnType<typeof useSWR>);
};

describe('ContextSuggestionChip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(videoLearningApi.recordWordEncounter).mockResolvedValue(undefined);
        usePlaybackSession.setState({ videoId: 'video-1', srtHash: 'subtitle-1' });
        useVocabularyStore.getState().clearVocabularyWords();
        useSetting.setState({
            values: new Map([['player.vocabularyGuidance', 'coach']]),
        });
    });

    it('教练模式展示一个可解释建议，并可展开看到理由与释义', async () => {
        mockSWR(newWordPack);
        render(<ContextSuggestionChip sentence={sentence} />);

        expect(screen.getByTestId('context-suggestion').textContent).toContain('journey');
        expect(screen.getByTestId('context-suggestion').textContent).toContain('contextSuggestion.reasons.useful_new_word');
        await waitFor(() => {
            expect(videoLearningApi.recordWordEncounter).toHaveBeenCalledWith(expect.objectContaining({
                word: 'journey',
                action: 'seen',
            }));
        });

        fireEvent.click(screen.getByTestId('context-suggestion'));

        expect(screen.getByText('旅程')).toBeDefined();
        expect(screen.getByText('contextSuggestion.why')).toBeDefined();
        expect(screen.getAllByText('contextSuggestion.reasons.useful_new_word').length).toBeGreaterThan(0);
    });

    it('可以忽略当前句子的建议', () => {
        mockSWR(newWordPack);
        render(<ContextSuggestionChip sentence={sentence} />);

        fireEvent.click(screen.getByRole('button', { name: 'contextSuggestion.dismiss' }));

        expect(screen.queryByTestId('context-suggestion')).toBeNull();
    });

    it('加入学习会收藏单词、更新词表并记录 save 证据', async () => {
        mockSWR(newWordPack);
        vi.mocked(videoLearningApi.favoriteWord).mockResolvedValue({
            success: true,
            data: {
                word: 'journey',
                translate: '旅程',
                alreadyExists: false,
            },
        });
        render(<ContextSuggestionChip sentence={sentence} />);

        fireEvent.click(screen.getByTestId('context-suggestion'));
        fireEvent.click(screen.getByRole('button', { name: 'contextSuggestion.favorite' }));

        await waitFor(() => {
            expect(videoLearningApi.favoriteWord).toHaveBeenCalledWith('journey', '旅程');
        });
        await waitFor(() => {
            expect(videoLearningApi.recordWordEncounter).toHaveBeenCalledWith(expect.objectContaining({
                word: 'journey',
                action: 'save',
            }));
        });
        expect(useVocabularyStore.getState().isVocabularyWord('journey')).toBe(true);
    });

    it('已在学习清单的词展示状态而不重复提供加入学习', () => {
        mockSWR(userWordPack);
        render(<ContextSuggestionChip sentence={sentence} />);

        fireEvent.click(screen.getByTestId('context-suggestion'));

        expect(screen.getByText('contextSuggestion.alreadyLearning')).toBeDefined();
        expect(screen.queryByRole('button', { name: 'contextSuggestion.favorite' })).toBeNull();
    });

    it('忽略学习词的当前句建议不会把词移出学习清单', async () => {
        mockSWR(userWordPack);
        useVocabularyStore.getState().setWordStatus('journey', 'learning');
        render(<ContextSuggestionChip sentence={sentence} />);

        fireEvent.click(screen.getByTestId('context-suggestion'));
        fireEvent.click(screen.getByRole('button', { name: 'contextSuggestion.ignore' }));

        await waitFor(() => {
            expect(screen.queryByTestId('context-suggestion')).toBeNull();
        });
        expect(videoLearningApi.updateWordState).not.toHaveBeenCalled();
        expect(useVocabularyStore.getState().getWordStatus('journey')).toBe('learning');
    });

    it('安静模式不渲染建议位', () => {
        mockSWR(newWordPack);
        useSetting.setState({
            values: new Map([['player.vocabularyGuidance', 'calm']]),
        });
        const { container } = render(<ContextSuggestionChip sentence={sentence} />);

        expect(container.firstChild).toBeNull();
    });
});
