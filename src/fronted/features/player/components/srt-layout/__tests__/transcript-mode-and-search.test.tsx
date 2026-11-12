import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import useLayout from '@/fronted/app/stores/layoutStore';
import SideSentence from '../SideSentence';
import ArticleBlock from '../components/ArticleBlock';
import type { Sentence } from '@/common/types/SentenceC';
import type { SentenceBlock } from '@/fronted/features/player/lib/sentence-grouping';

describe('Layout store - transcriptViewMode', () => {
    beforeEach(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.clear();
        }
        useLayout.setState({ transcriptViewMode: 'sentence' });
    });

    it('initializes with sentence mode by default', () => {
        expect(useLayout.getState().transcriptViewMode).toBe('sentence');
    });

    it('updates mode and saves to localStorage via setTranscriptViewMode', () => {
        useLayout.getState().setTranscriptViewMode('article');
        expect(useLayout.getState().transcriptViewMode).toBe('article');
        expect(localStorage.getItem('dashplayer.transcript_view_mode')).toBe('article');
    });

    it('toggles between sentence and article mode via toggleTranscriptViewMode', () => {
        useLayout.getState().toggleTranscriptViewMode();
        expect(useLayout.getState().transcriptViewMode).toBe('article');
        useLayout.getState().toggleTranscriptViewMode();
        expect(useLayout.getState().transcriptViewMode).toBe('sentence');
    });
});

const createMockSentence = (overrides: Partial<Sentence>): Sentence => ({
    fileHash: 'test-hash-1',
    index: 1,
    start: 0,
    end: 5,
    adjustedStart: null,
    adjustedEnd: null,
    text: '',
    textZH: '',
    key: 'test-key-1',
    transGroup: 1,
    translationKey: 'test-hash-1:1',
    struct: { original: '', blocks: [] },
    ...overrides,
});

describe('SideSentence - Single repeat shadowing loop & search highlight', () => {
    const mockSentence: Sentence = createMockSentence({
        index: 1,
        start: 10,
        end: 15,
        text: 'This is an amazing transcript search test.',
        textZH: '这是一个极好的字幕搜索测试。',
    });

    it('renders single-sentence loop button and invokes onToggleSingleRepeat on click', () => {
        const onToggle = vi.fn();
        const onClick = vi.fn();

        render(
            <SideSentence
                sentence={mockSentence}
                onClick={onClick}
                isCurrent={true}
                isRepeat={true}
                onToggleSingleRepeat={onToggle}
            />,
        );

        const repeatBtn = screen.getByRole('button', { name: /cancel single-sentence loop|关闭单句循环/i });
        expect(repeatBtn).not.toBeNull();
        fireEvent.click(repeatBtn);
        expect(onToggle).toHaveBeenCalledWith(mockSentence);
    });

    it('highlights search match across English and Chinese', () => {
        const { container } = render(
            <SideSentence
                sentence={mockSentence}
                onClick={vi.fn()}
                isCurrent={false}
                isRepeat={false}
                searchQuery="transcript"
                isActiveSearchMatch={true}
            />,
        );

        const marks = container.querySelectorAll('mark');
        expect(marks.length).toBeGreaterThan(0);
        expect(marks[0].textContent).toBe('transcript');
    });

    it('invokes onClick callback when replay button is clicked', () => {
        const onClick = vi.fn();
        render(
            <SideSentence
                sentence={mockSentence}
                onClick={onClick}
                isCurrent={false}
                isRepeat={false}
            />,
        );

        const replayBtn = screen.getByRole('button', { name: /replay sentence|从头重播此句/i });
        fireEvent.click(replayBtn);
        expect(onClick).toHaveBeenCalledWith(mockSentence);
    });

    it('invokes onClick callback on Enter key press', () => {
        const onClick = vi.fn();
        const { container } = render(
            <SideSentence
                sentence={mockSentence}
                onClick={onClick}
                isCurrent={false}
                isRepeat={false}
            />,
        );

        // 整行点击区是行内唯一的 role=button；行尾的操作按钮是它的兄弟节点。
        const card = container.querySelector('[role="button"]') as HTMLElement;
        fireEvent.keyDown(card, { key: 'Enter' });
        expect(onClick).toHaveBeenCalledWith(mockSentence);
    });

    it('shows Chinese translation when search matches Chinese even if showSideTranslation is false', () => {
        const { container } = render(
            <SideSentence
                sentence={mockSentence}
                onClick={vi.fn()}
                isCurrent={false}
                isRepeat={false}
                searchQuery="测试"
            />,
        );

        const mark = container.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark?.textContent).toBe('测试');
    });

    /**
     * 文稿行只保留时间戳与正文：待学词/有印象词的圆点与数量已从阅读区移除，
     * 词汇能力改由筛选菜单提供。
     */
    it('renders no vocabulary status dots or counts in the transcript row', () => {
        const { container } = render(
            <SideSentence
                sentence={mockSentence}
                onClick={vi.fn()}
                isCurrent={false}
                isRepeat={false}
            />,
        );

        expect(container.querySelector('[data-testid="sentence-vocabulary-dots"]')).toBeNull();
    });

    /**
     * Astryx 的 Item 规范明确禁止在可交互行内嵌套按钮：焦点目标会重叠，
     * Enter/Space 会同时触发行动作与按钮动作。这里锁定结构而不是样式。
     */
    it('keeps the row action button free of nested interactive controls', () => {
        const { container } = render(
            <SideSentence
                sentence={mockSentence}
                onClick={vi.fn()}
                isCurrent={true}
                isRepeat={false}
                onToggleSingleRepeat={vi.fn()}
            />,
        );

        const row = container.querySelector('[role="button"]') as HTMLElement;
        expect(row).not.toBeNull();
        expect(row.querySelector('button, a, input, select, textarea')).toBeNull();
        // 操作按钮仍然存在，只是作为行的兄弟节点。
        expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    });
});

describe('ArticleBlock - Flowing article layout', () => {
    const sentence1: Sentence = createMockSentence({
        index: 1,
        start: 0,
        end: 3,
        text: 'Welcome to the flowing article mode.',
        textZH: '欢迎来到连贯讲稿模式。',
        fileHash: 'hash-art',
    });
    const sentence2: Sentence = createMockSentence({
        index: 2,
        start: 3.2,
        end: 6.5,
        text: 'It presents comfortable book-like typography.',
        textZH: '它呈现舒适的书卷式排版。',
        fileHash: 'hash-art',
    });

    const mockBlock: SentenceBlock = {
        sentences: [sentence1, sentence2],
        start: 0,
        end: 6.5,
        charCount: sentence1.text.length + sentence2.text.length,
        repr: sentence1,
    };

    it('renders sentences in paragraph flow and illuminates current sentence', () => {
        const onSentenceClick = vi.fn();
        const { container } = render(
            <ArticleBlock
                block={mockBlock}
                currentSentence={sentence1}
                searchQuery=""
                activeMatchedSentenceIndex={-1}
                showSideTranslation={true}
                onSentenceClick={onSentenceClick}
            />,
        );

        // English sentences are rendered
        expect(container.textContent).toContain('Welcome to the flowing article mode.');
        expect(container.textContent).toContain('It presents comfortable book-like typography.');

        // Current sentence has illuminated styling
        const s1Element = container.querySelector('[data-sentence-index="1"]');
        expect(s1Element?.className).toContain('bg-accent/20');

        // Clicking sentence triggers callback
        if (s1Element) {
            fireEvent.click(s1Element);
            expect(onSentenceClick).toHaveBeenCalledWith(sentence1);
        }
    });

    it('highlights search match inside article mode', () => {
        const { container } = render(
            <ArticleBlock
                block={mockBlock}
                currentSentence={null}
                searchQuery="typography"
                activeMatchedSentenceIndex={2}
                showSideTranslation={false}
                onSentenceClick={vi.fn()}
            />,
        );

        const mark = container.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark?.textContent).toBe('typography');
    });

    it('renders single-sentence loop button for active sentence in article mode and invokes callback', () => {
        const onToggle = vi.fn();
        render(
            <ArticleBlock
                block={mockBlock}
                currentSentence={sentence1}
                searchQuery=""
                activeMatchedSentenceIndex={-1}
                showSideTranslation={false}
                onSentenceClick={vi.fn()}
                onToggleSingleRepeat={onToggle}
                isRepeat={false}
            />,
        );

        const repeatBtn = screen.getByRole('button', { name: /loop sentence|开启单句循环/i });
        expect(repeatBtn).not.toBeNull();
        fireEvent.click(repeatBtn);
        expect(onToggle).toHaveBeenCalledWith(sentence1);
    });

    it('reveals Chinese translation in article mode when Chinese query matches even if showSideTranslation is false', () => {
        const { container } = render(
            <ArticleBlock
                block={mockBlock}
                currentSentence={null}
                searchQuery="讲稿"
                activeMatchedSentenceIndex={1}
                showSideTranslation={false}
                onSentenceClick={vi.fn()}
            />,
        );

        const mark = container.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark?.textContent).toBe('讲稿');
    });
});
