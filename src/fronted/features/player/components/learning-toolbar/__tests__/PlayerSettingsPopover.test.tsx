import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlayerSettingsPopover from '../PlayerSettingsPopover';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key,
        }),
    };
});

vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        deleteTimestampAdjustment: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/fronted/features/player/components/learning-toolbar/TimeAdjustPanel', () => ({
    default: () => <div data-testid="mock-time-adjust-panel">TimeAdjustPanel</div>,
}));

describe('PlayerSettingsPopover', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the 3-line quick remote controls and opens popover', () => {
        render(<PlayerSettingsPopover tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBox\.title/i });
        expect(trigger).toBeDefined();

        fireEvent.click(trigger);
        expect(screen.getByTestId('player-setting-sentence-block')).toBeDefined();
        expect(screen.getByTestId('player-setting-pause-on-hover')).toBeDefined();
        expect(screen.getByTestId('player-setting-auto-play-next')).toBeDefined();
    });

    it('can switch to timing calibration tab without opening secondary popover', () => {
        render(<PlayerSettingsPopover tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBox\.title/i });
        fireEvent.click(trigger);

        // Click the timing tab segment
        const timingTab = screen.getByRole('radio', { name: /字幕时间/i });
        fireEvent.click(timingTab);

        expect(screen.getByTestId('mock-time-adjust-panel')).toBeDefined();
    });

    it('toggles sentence block mode setting successfully', () => {
        render(<PlayerSettingsPopover tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBox\.title/i });
        fireEvent.click(trigger);

        const initialVal = usePlayerUi.getState().sentenceBlockMode;
        const blockSwitch = screen.getByTestId('player-setting-sentence-block');
        const input = blockSwitch.querySelector('input') || blockSwitch;
        fireEvent.click(input);
        expect(usePlayerUi.getState().sentenceBlockMode).toBe(!initialVal);
    });

    it('navigates to full settings when clicking bottom entry', () => {
        render(<PlayerSettingsPopover tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBox\.title/i });
        fireEvent.click(trigger);

        const allSettingsBtn = screen.getByRole('button', { name: /全部播放设置/i });
        fireEvent.click(allSettingsBtn);
        expect(mockNavigate).toHaveBeenCalledWith('/settings/appearance');
    });

    it('renders podcast mode switch', () => {
        render(<PlayerSettingsPopover tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBox\.title/i });
        fireEvent.click(trigger);

        expect(screen.getByTestId('player-setting-podcast-mode')).toBeInTheDocument();
    });

    it('中文可见时显示自适应中文字幕开关', () => {
        render(<PlayerSettingsPopover tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBox\.title/i });
        fireEvent.click(trigger);

        expect(screen.getByTestId('player-setting-adaptive-chinese')).toBeInTheDocument();
    });
});
