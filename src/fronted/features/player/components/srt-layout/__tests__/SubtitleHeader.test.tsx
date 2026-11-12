import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Subtitle from '../components/Subtitle';
import useLayout from '@/fronted/app/stores/layoutStore';

vi.mock('react-virtuoso', () => ({
    Virtuoso: () => <div data-testid="mock-virtuoso" />,
}));

vi.mock('@/fronted/features/player/hooks/useBoundary', () => ({
    default: () => ({ setBoundaryRef: vi.fn() }),
}));

describe('Subtitle Header - Clean Architecture & Refactored Toolbar', () => {
    beforeEach(() => {
        useLayout.setState({
            showTranscript: true,
            transcriptViewMode: 'sentence',
        });
    });

    it('renders segmented control for view mode and toggles mode on selection', () => {
        render(<Subtitle />);

        // 左侧分段控件：逐句 与 讲稿
        const sentenceSegment = screen.getByRole('radio', { name: /逐句|Sentence/i });
        const articleSegment = screen.getByRole('radio', { name: /讲稿|Article/i });

        expect(sentenceSegment).toBeDefined();
        expect(articleSegment).toBeDefined();

        // 默认是逐句模式
        expect(sentenceSegment.getAttribute('aria-checked')).toBe('true');
        expect(articleSegment.getAttribute('aria-checked')).toBe('false');

        // 切换到讲稿模式
        fireEvent.click(articleSegment);
        expect(useLayout.getState().transcriptViewMode).toBe('article');

        // 切换回逐句模式
        fireEvent.click(sentenceSegment);
        expect(useLayout.getState().transcriptViewMode).toBe('sentence');
    });

    it('removes ambiguous docking toggle icon and static book icon', () => {
        render(<Subtitle />);

        // 不应存在左右停靠切换按钮
        expect(screen.queryByLabelText(/将文稿切换至|dock to/i)).toBeNull();

        // 保留核心操作：筛选、译文、搜索、收起文稿
        expect(screen.getByRole('button', { name: /筛选|filter/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /搜索文稿|search transcript/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /收起字幕文稿|hide transcript/i })).toBeDefined();
    });

    it('collapses transcript panel when close button is clicked', () => {
        render(<Subtitle />);

        const closeBtn = screen.getByRole('button', { name: /收起字幕文稿|hide transcript/i });
        fireEvent.click(closeBtn);
        expect(useLayout.getState().showTranscript).toBe(false);
    });
});
