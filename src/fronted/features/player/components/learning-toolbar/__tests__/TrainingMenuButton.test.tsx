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

    it('renders listening training mode radio options and assistant switches when opened', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        const trigger = screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i });
        fireEvent.click(trigger);

        expect(screen.getByRole('radiogroup')).toBeDefined();
        expect(screen.getByTestId('training-mode-off')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('training-mode-single-repeat')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-mode-auto-pause')).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByTestId('training-mode-shadowing')).toBeNull();
        expect(screen.getByTestId('training-mode-loop-times')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-mode-loop-rates')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('training-assist-skip-gap')).toBeDefined();
        expect(screen.getByTestId('training-assist-rewind-resume')).toBeDefined();
        expect(screen.getByTestId('training-settings-button')).toBeDefined();
    });

    it('switches to auto-pause mode and can reset back to continuous playback', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i }));

        fireEvent.click(screen.getByTestId('training-mode-auto-pause'));
        expect(playerActions.setAutoPause).toHaveBeenCalledWith(true);

        act(() => {
            usePlayer.setState({ autoPause: true });
        });
        expect(screen.getByTestId('training-mode-auto-pause')).toHaveAttribute('aria-checked', 'true');
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

    /**
     * 面板本身已经由触发按钮定位，再在顶部重复一遍「精听与训练模式」只是噪音。
     * 可访问名称仍由 radiogroup / dialogLabel 提供，不依赖这行可见标题。
     */
    it('面板内不再重复渲染可见标题', () => {
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i }));

        expect(screen.queryByText('controlBar.trainingMenuLabel')).toBeNull();
        // 语义名称仍然保留在分组上，读屏不受影响
        expect(screen.getByRole('radiogroup').getAttribute('aria-label')).toBe('controlBar.trainingMenuLabel');
    });

    it('订阅 shadowing 状态后不会错误把连续播放标成激活态', () => {
        act(() => {
            usePlayer.setState({ shadowing: true });
        });
        render(<TrainingMenuButton tone="panel" popoverOffset={8} />);
        fireEvent.click(screen.getByRole('button', { name: /controlBar\.trainingMenuLabel/i }));

        expect(screen.getByTestId('training-mode-off')).toHaveAttribute('aria-checked', 'false');
    });
});
