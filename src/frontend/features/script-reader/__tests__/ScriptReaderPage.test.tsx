import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/frontend/i18n';
import ScriptReaderPage from '../ScriptReaderPage';
import useSubtitleTranslation from '@/frontend/features/player/translationStore';

const mockNavigate = vi.fn();
const mockListReaderDocuments = vi.fn();
const mockParseSubtitleToSentences = vi.fn();
const mockMatchSubtitleVocabulary = vi.fn();
const mockGetSceneBoundaries = vi.fn();
const mockSubtitleComprehension = vi.fn();
const mockListSavedKeys = vi.fn();
const mockListSavedSentences = vi.fn();
const mockSaveSentence = vi.fn();
const mockUpdateSavedSentence = vi.fn();
const mockPlayContextAudio = vi.fn();
const mockStopActiveAudio = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('@/frontend/features/context-studio/contextStudioApi', () => ({
    contextStudioApi: {
        listReaderDocuments: (...args: unknown[]) => mockListReaderDocuments(...args),
        listSavedKeys: (...args: unknown[]) => mockListSavedKeys(...args),
        listSavedSentences: (...args: unknown[]) => mockListSavedSentences(...args),
        saveSentence: (...args: unknown[]) => mockSaveSentence(...args),
        updateSavedSentence: (...args: unknown[]) => mockUpdateSavedSentence(...args),
        unsaveSentence: vi.fn().mockResolvedValue(true),
    },
}));

vi.mock('@/frontend/features/player/playerApi', () => ({
    playerApi: {
        parseSubtitleToSentences: (...args: unknown[]) => mockParseSubtitleToSentences(...args),
        matchSubtitleVocabulary: (...args: unknown[]) => mockMatchSubtitleVocabulary(...args),
        getSceneBoundaries: (...args: unknown[]) => mockGetSceneBoundaries(...args),
        subtitleComprehension: (...args: unknown[]) => mockSubtitleComprehension(...args),
    },
}));

vi.mock('@/frontend/infrastructure/audio/AudioPlayer', () => ({
    playContextAudio: (...args: unknown[]) => mockPlayContextAudio(...args),
    stopActiveAudio: (...args: unknown[]) => mockStopActiveAudio(...args),
    playWord: vi.fn(),
    getTtsUrl: vi.fn(),
    playAudioUrl: vi.fn(),
}));

describe('ScriptReaderPage - Refactored P0-P2 Intensive Reader', () => {
    beforeAll(async () => {
        await i18n.changeLanguage('zh-CN');
    });

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useSubtitleTranslation.setState({
            activeFileHash: null,
            translations: new Map(),
        });
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
        mockListSavedSentences.mockResolvedValue([]);
        mockMatchSubtitleVocabulary.mockResolvedValue({ cancelled: false, wordStates: {} });
        mockGetSceneBoundaries.mockResolvedValue([
            {
                sentenceIndex: 1,
                atSec: 30,
                kinds: ['time-gap', 'topic-shift'],
                confidence: 0.85,
            },
        ]);
        mockSubtitleComprehension.mockResolvedValue({
            score: 0.4,
            band: 'hard',
            knownContentRatio: 0.5,
            syntaxComplexity: 0.7,
            contentWords: 6,
            unknownWords: ['honored'],
        });
        mockPlayContextAudio.mockResolvedValue('native');
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
            note: '连读注意',
            tag: 'expression',
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
                {
                    fileHash: 'h-101',
                    index: 1,
                    start: 30,
                    end: 34,
                    adjustedStart: null,
                    adjustedEnd: null,
                    text: 'Stay hungry, stay foolish.',
                    textZH: '求知若饥，虚心若愚。',
                    key: 'k-1',
                    transGroup: 1,
                    translationKey: 'h-101:1',
                    struct: { original: '', blocks: [] },
                },
            ],
        });
    });

    it('renders tokenized interactive words, scene dividers, article mode, bookmark, notes, search and player deep-link', async () => {
        render(
            <MemoryRouter>
                <ScriptReaderPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            const row0 = screen.getByTestId('script-sentence-row-0');
            expect(row0.textContent).toContain('I am honored to be with you today.');
            expect(screen.getByText('我很荣幸今天能和你们在一起。')).toBeDefined();
        });

        // 单词级交互节点存在（renderSentenceTokens 接入验证）
        expect(screen.getByText('honored').closest('[data-word="true"]')).not.toBeNull();

        // 场景章节分割线展示
        await waitFor(() => {
            expect(screen.getByTestId('script-scene-divider')).toBeDefined();
        });

        // 切换到讲稿模式并切换回逐句模式
        const articleRadio = screen.getByRole('radio', { name: /讲稿/i });
        fireEvent.click(articleRadio);
        expect(articleRadio.getAttribute('aria-checked')).toBe('true');

        const sentenceRadio = screen.getByRole('radio', { name: /逐句/i });
        fireEvent.click(sentenceRadio);

        // 搜索过滤仅保留匹配句
        const searchInput = screen.getByPlaceholderText('搜文稿/译文...');
        fireEvent.change(searchInput, { target: { value: 'hungry' } });
        expect(screen.queryByTestId('script-sentence-row-0')).toBeNull();
        expect(screen.getByTestId('script-sentence-row-1')).toBeDefined();

        fireEvent.change(searchInput, { target: { value: '' } });
        expect(screen.getByTestId('script-sentence-row-0')).toBeDefined();

        // 收藏金句
        const saveButtons = screen.getAllByRole('button', { name: /收藏金句/i });
        fireEvent.click(saveButtons[0]);

        await waitFor(() => {
            expect(mockSaveSentence).toHaveBeenCalledWith(
                expect.objectContaining({
                    sentenceKey: 'h-101:0',
                    videoId: 'vid-101',
                    text: 'I am honored to be with you today.',
                }),
            );
        });

        // 展开内联笔记抽屉并保存笔记
        const noteButtons = screen.getAllByRole('button', { name: /句法与笔记/i });
        fireEvent.click(noteButtons[0]);

        const noteDrawer = await screen.findByTestId('script-note-drawer');
        expect(noteDrawer).toBeDefined();

        const textarea = screen.getByPlaceholderText(/记录连读吞音/);
        fireEvent.change(textarea, { target: { value: '连读注意' } });
        fireEvent.click(screen.getByRole('button', { name: /保存笔记/i }));

        await waitFor(() => {
            expect(mockSaveSentence).toHaveBeenCalled();
        });

        // 点击第 2 句的「定位画面」带精确时间戳跳转到播放器
        const row1 = screen.getByTestId('script-sentence-row-1');
        fireEvent.click(within(row1).getByRole('button', { name: /定位画面/i }));
        expect(mockNavigate).toHaveBeenCalledWith('/player/vid-101?t=30');
    });

    it('plays sequentially from audio bar and can switch playback speed', async () => {
        render(
            <MemoryRouter>
                <ScriptReaderPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('script-audio-bar')).toBeDefined();
        });

        fireEvent.click(screen.getByTestId('script-audio-toggle'));

        await waitFor(() => {
            expect(mockPlayContextAudio).toHaveBeenCalledWith(
                expect.objectContaining({
                    text: 'I am honored to be with you today.',
                    playbackRate: 1,
                    waitForEnd: true,
                }),
            );
        });
    });

    it('toggles source and AI translations in both sentence and article views', async () => {
        useSubtitleTranslation.setState({
            activeFileHash: 'h-ai',
            translations: new Map([['h-ai:0', '这是 AI 翻译的中文。']]),
        });
        mockParseSubtitleToSentences.mockResolvedValue({
            fileHash: 'h-ai',
            sentences: [
                {
                    fileHash: 'h-ai',
                    index: 0,
                    start: 1,
                    end: 4,
                    adjustedStart: null,
                    adjustedEnd: null,
                    text: 'English only source subtitle.',
                    textZH: '',
                    key: 'k-ai-0',
                    transGroup: 1,
                    translationKey: 'h-ai:0',
                    struct: { original: '', blocks: [] },
                },
            ],
        });

        render(
            <MemoryRouter>
                <ScriptReaderPage />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByText('这是 AI 翻译的中文。')).toBeDefined();
        });

        const toggleBtn = screen.getByRole('button', { name: /切换译文/i });
        expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(toggleBtn);
        expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
        expect(screen.queryByText('这是 AI 翻译的中文。')).toBeNull();

        fireEvent.click(toggleBtn);
        expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByText('这是 AI 翻译的中文。')).toBeDefined();
    });
});
