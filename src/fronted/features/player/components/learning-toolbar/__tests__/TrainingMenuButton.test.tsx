import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TrainingMenuButton from '../TrainingMenuButton';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { useTrainingModeStore } from '@/fronted/features/player/trainingStore';

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key,
        }),
    };
});

vi.mock('@/fronted/features/player/components/PlayerActions', () => ({
    playerActions: {
        setSingleRepeat: vi.fn(),
        setAutoPause: vi.fn(),
        setShadowing: vi.fn(),
        setSentenceLoop: vi.fn(),
        setSkipGap: vi.fn(),
        setRewindOnResume: vi.fn(),
    },
}));

vi.mock('@/fronted/features/player/components/TrainingSettingsDialog', () => ({
    TrainingSettingsDialog: ({ open }: { open: boolean }) =>
        open ? <div data-testid="mock-training-settings-dialog">TrainingSettingsDialog</div> : null,
}));

describe('TrainingMenuButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        act(() => {
            usePlayer.setState({
                singleRepeat: false,
                autoPause: false,
                shadowing: false,
                sentenceLoop: null,
            });
            useTrainingModeStore.setState({
                skipGap: false,
                rewindOnResume: false,
            });
        });
    });

    it('renders all training mode radio options and assistant switches when opened', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i });
        fireEvent.click(trigger);

        expect(screen.getByRole('radiogroup')).toBeDefined();
        expect(screen.getByTestId('training-mode-off')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('training-mode-single-repeat')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-mode-auto-pause')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-mode-shadowing')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-mode-loop-times')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-mode-loop-rates')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-assist-skip-gap')).toBeDefined();
        expect(screen.getByTestId('training-assist-rewind-resume')).toBeDefined();
        expect(screen.getByTestId('training-settings-button')).toBeDefined();
    });

    it('switches to shadowing mode and can reset back to continuous playback', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i }));

        fireEvent.click(screen.getByTestId('training-mode-shadowing'));
        expect(playerActions.setShadowing).toHaveBeenCalledWith(true);

        act(() => {
            usePlayer.setState({ shadowing: true });
        });
        expect(screen.getByTestId('training-mode-shadowing')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('training-mode-off')).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(screen.getByTestId('training-mode-off'));
        expect(playerActions.setSingleRepeat).toHaveBeenCalledWith(false);
        expect(playerActions.setAutoPause).toHaveBeenCalledWith(false);
        expect(playerActions.setShadowing).toHaveBeenCalledWith(false);
        expect(playerActions.setSentenceLoop).toHaveBeenCalledWith(null);
    });

    it('toggles skipGap assistant switch', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i }));

        const switchWrapper = screen.getByTestId('training-assist-skip-gap');
        const input = switchWrapper.querySelector('input') || switchWrapper;
        fireEvent.click(input);
        expect(playerActions.setSkipGap).toHaveBeenCalledWith(true);
    });

    it('opens training settings dialog when clicking bottom settings button', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i }));

        fireEvent.click(screen.getByTestId('training-settings-button'));
        expect(screen.getByTestId('mock-training-settings-dialog')).toBeDefined();
    });

    it('displays formatted rate chain pill cleanly on loop rates option', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i }));

        expect(screen.getByTestId('training-mode-loop-rates').textContent).toContain('0.75→1→1.25x');
    });
});
