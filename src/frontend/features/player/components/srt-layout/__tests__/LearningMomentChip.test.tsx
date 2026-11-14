import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

import LearningMomentChip from '../LearningMomentChip';
import type { LearningMomentCandidate } from '@/common/learning/learningMoment';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

const candidate: LearningMomentCandidate = {
    word: 'journey',
    surface: 'journey',
    phonetic: '/ˈdʒɜːni/',
    meaning: '旅程',
    status: 'learning',
    mastery: 0.3,
    dueAt: '2026-11-11T12:00:00.000Z',
    score: 0.72,
};

const renderChip = (override: Partial<ComponentProps<typeof LearningMomentChip>> = {}) => {
    const props = {
        candidate,
        open: false,
        pending: false,
        onOpenChange: vi.fn(),
        onDismiss: vi.fn(),
        onRate: vi.fn(),
        ...override,
    };
    render(<LearningMomentChip {...props} />);
    return props;
};

describe('LearningMomentChip', () => {
    it('折叠态展示到期词与低干扰提示', () => {
        renderChip();

        const trigger = screen.getByTestId('learning-moment');
        expect(trigger.textContent).toContain('journey');
        expect(trigger.textContent).toContain('prompt');
    });

    it('先回忆再揭示释义，并用二档反馈提交复习', () => {
        const onRate = vi.fn();
        renderChip({ open: true, onRate });

        expect(screen.getByText('recallHint')).toBeDefined();
        expect(screen.queryByText('旅程')).toBeNull();

        fireEvent.click(screen.getByTestId('learning-moment-reveal'));

        expect(screen.getByText('旅程')).toBeDefined();
        fireEvent.click(screen.getByTestId('learning-moment-remembered'));
        expect(onRate).toHaveBeenCalledWith('good');

        fireEvent.click(screen.getByTestId('learning-moment-forgotten'));
        expect(onRate).toHaveBeenCalledWith('again');
    });

    /**
     * §6.4「强化：更积极的复习和口语任务」。口语入口只在父级传入时出现，
     * 安静/教练档不传，因此同一个组件不会在低强度下多出一个动作。
     */
    it('强化档揭示后可以从回忆直接进入跟读', () => {
        const onStartShadowing = vi.fn();
        renderChip({ open: true, onStartShadowing });

        expect(screen.queryByTestId('learning-moment-shadowing')).toBeNull();
        fireEvent.click(screen.getByTestId('learning-moment-reveal'));
        fireEvent.click(screen.getByTestId('learning-moment-shadowing'));

        expect(onStartShadowing).toHaveBeenCalledTimes(1);
    });

    it('未传入口语入口时不渲染该按钮', () => {
        renderChip({ open: true });
        fireEvent.click(screen.getByTestId('learning-moment-reveal'));

        expect(screen.queryByTestId('learning-moment-shadowing')).toBeNull();
    });

    it('稍后再说只关闭当前时刻', () => {
        const onDismiss = vi.fn();
        renderChip({ onDismiss });

        fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
