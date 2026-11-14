import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Sentence } from '@/common/types/SentenceC';
import SideSentence from '../SideSentence';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/frontend/features/player/playerState', () => ({
    usePlayerState: () => false,
}));

const sentence: Sentence = {
    fileHash: 'hash-reset',
    index: 3,
    start: 10,
    end: 12,
    adjustedStart: null,
    adjustedEnd: null,
    text: 'The journey begins here.',
    textZH: '旅程从这里开始。',
    key: 'key-3',
    transGroup: 1,
    translationKey: 'hash-reset:3',
    struct: { original: '', blocks: [] },
};

const renderRow = (override: Partial<React.ComponentProps<typeof SideSentence>> = {}) => {
    const props = {
        sentence,
        onClick: vi.fn(),
        isCurrent: false,
        isRepeat: false,
        ...override,
    };
    render(<SideSentence {...props} />);
    return props;
};

describe('SideSentence 时间轴复位徽章', () => {
    /**
     * 用户是在文稿行里调的时间轴，就必须能在同一行退回去。
     * 此前只有播客模式有复位入口，文稿里调完就再也回不来。
     */
    it('调整过时间轴时显示复位徽章，点击复位这一句', () => {
        const onResetTime = vi.fn();
        renderRow({ isTimeAdjusted: true, onResetTime });

        const badge = screen.getByTestId('side-sentence-reset-time');
        fireEvent.click(badge);

        // 必须把「这一句」传出去：只复位当前播放句会复位错行。
        expect(onResetTime).toHaveBeenCalledWith(sentence);
    });

    it('未调整时不渲染徽章，避免每行都挂一个无效动作', () => {
        renderRow({ onResetTime: vi.fn() });
        expect(screen.queryByTestId('side-sentence-reset-time')).toBeNull();
    });
});
