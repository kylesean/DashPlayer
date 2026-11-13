import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Subtitle from '../components/Subtitle';
import useLayout from '@/fronted/app/stores/layoutStore';
import useSetting from '@/fronted/features/settings/settingsStore';

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
        useSetting.setState({
            init: true,
            values: new Map([['appearance.transcriptPosition', 'right']]),
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

    it('renders docking toggle beside collapse control and toggles transcript side', () => {
        const setSettingSpy = vi.fn().mockResolvedValue(undefined);
        useSetting.setState({ setSetting: setSettingSpy });

        render(<Subtitle />);

        // 保留核心操作：筛选、译文、搜索、停靠切换、收起文稿
        expect(screen.getByRole('button', { name: /筛选|filter/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /搜索文稿|search transcript/i })).toBeDefined();
        const dockBtn = screen.getByRole('button', { name: /将文稿切换至左侧|dock transcript to left/i });
        expect(dockBtn).toBeDefined();
        expect(screen.getByRole('button', { name: /收起字幕文稿|hide transcript/i })).toBeDefined();

        fireEvent.click(dockBtn);
        expect(setSettingSpy).toHaveBeenCalledWith('appearance.transcriptPosition', 'left');
    });

    it('shows dock-to-right action when transcript is docked on the left', () => {
        const setSettingSpy = vi.fn().mockResolvedValue(undefined);
        useSetting.setState({
            values: new Map([['appearance.transcriptPosition', 'left']]),
            setSetting: setSettingSpy,
        });

        render(<Subtitle />);

        const dockBtn = screen.getByRole('button', { name: /将文稿切换至右侧|dock transcript to right/i });
        fireEvent.click(dockBtn);
        expect(setSettingSpy).toHaveBeenCalledWith('appearance.transcriptPosition', 'right');
    });

    it('collapses transcript panel when close button is clicked', () => {
        render(<Subtitle />);

        const closeBtn = screen.getByRole('button', { name: /收起字幕文稿|hide transcript/i });
        fireEvent.click(closeBtn);
        expect(useLayout.getState().showTranscript).toBe(false);
    });
});
