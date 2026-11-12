import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScriptReaderPage from '../ScriptReaderPage';

const mockListReaderDocuments = vi.fn();
const mockParseSubtitleToSentences = vi.fn();
const mockListSavedKeys = vi.fn();
const mockSaveSentence = vi.fn();

vi.mock('@/fronted/features/context-studio/contextStudioApi', () => ({
    contextStudioApi: {
        listReaderDocuments: (...args: unknown[]) => mockListReaderDocuments(...args),
        listSavedKeys: (...args: unknown[]) => mockListSavedKeys(...args),
        saveSentence: (...args: unknown[]) => mockSaveSentence(...args),
        unsaveSentence: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        parseSubtitleToSentences: (...args: unknown[]) => mockParseSubtitleToSentences(...args),
    },
}));

describe('ScriptReaderPage - Standalone Script Reader Module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockListReaderDocuments.mockResolvedValue([
            {
                videoId: 'vid-101',
                title: 'Stanford Commencement',
                srtFile: '/videos/stanford.srt',
                videoPath: '/videos/stanford.mp4',
                updatedAt: '2026-11-12T00:00:00Z',
            },
        ]);
        mockListSavedKeys.mockResolvedValue([]);
        mockSaveSentence.mockResolvedValue({
            id: 1,
            sentenceKey: 'h-101:0',
            videoId: 'vid-101',
            videoTitle: 'Stanford Commencement',
            fileHash: 'h-101',
            sentenceIndex: 0,
            startTime: 1,
            endTime: 4,
            text: 'I am honored to be with you today.',
            textZh: '我很荣幸今天能和你们在一起。',
            note: '',
            tag: 'general',
            createdAt: '',
            updatedAt: '',
        });
        mockParseSubtitleToSentences.mockResolvedValue({
            fileHash: 'h-101',
            sentences: [
                {
                    fileHash: 'h-101',
                    index: 0,
                    start: 1,
                    end: 4,
                    adjustedStart: null,
                    adjustedEnd: null,
                    text: 'I am honored to be with you today.',
                    textZH: '我很荣幸今天能和你们在一起。',
                    key: 'k-0',
                    transGroup: 1,
                    translationKey: 'h-101:0',
                    struct: { original: '', blocks: [] },
                },
            ],
        });
    });

    it('loads documents, parses script sentences, and switches between sentence and article views', async () => {
        render(
            <MemoryRouter>
                <ScriptReaderPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByText('I am honored to be with you today.')).toBeDefined();
            expect(screen.getByText('我很荣幸今天能和你们在一起。')).toBeDefined();
        });

        // 切换到讲稿模式
        const articleRadio = screen.getByRole('radio', { name: /讲稿/i });
        fireEvent.click(articleRadio);
        expect(articleRadio.getAttribute('aria-checked')).toBe('true');

        // 切换回逐句模式
        const sentenceRadio = screen.getByRole('radio', { name: /逐句/i });
        fireEvent.click(sentenceRadio);

        // 点击收藏金句按钮
        const saveBtn = screen.getByRole('button', { name: /收藏金句/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockSaveSentence).toHaveBeenCalledWith(
                expect.objectContaining({
                    sentenceKey: 'h-101:0',
                    videoId: 'vid-101',
                    text: 'I am honored to be with you today.',
                }),
            );
        });
    });
});
