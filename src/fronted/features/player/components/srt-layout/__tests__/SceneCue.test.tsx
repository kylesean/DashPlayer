import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import SceneCue from '../SceneCue';
import type { Sentence } from '@/common/types/SentenceC';
import useSetting from '@/fronted/features/settings/settingsStore';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

const sentence = (index: number, text: string, start: number, end: number): Sentence => ({
    fileHash: 'hash',
    index,
    start,
    end,
    adjustedStart: null,
    adjustedEnd: null,
    text,
    textZH: '',
    key: `hash-${index}`,
    transGroup: 1,
    translationKey: `hash:${index}`,
    struct: { original: text, blocks: [] },
});

const withBoundary = [
    sentence(0, 'The journey starts tomorrow morning.', 0, 2),
    sentence(1, 'Are you ready for the journey?', 2, 4),
    sentence(2, 'Yes.', 4, 4.6),
];

const continuous = [
    sentence(0, 'The journey begins at the station.', 0, 2),
    sentence(1, 'The journey continues through the valley.', 2, 4),
    sentence(2, 'The journey ends at the station.', 4, 6),
];

const setSceneCues = (value: 'true' | 'false') => {
    useSetting.setState({
        values: new Map([['player.sceneCues', value]]),
    });
};

describe('SceneCue', () => {
    beforeEach(() => {
        setSceneCues('false');
    });

    it('开关关闭时不展示提示', () => {
        render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[2]} />);

        expect(screen.queryByTestId('scene-cue')).toBeNull();
    });

    it('开关开启且当前句命中边界时展示提示', () => {
        setSceneCues('true');
        render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[2]} />);

        expect(screen.getByTestId('scene-cue').textContent).toBe('sceneCue.speakerShift');
    });

    it('普通连续字幕不展示提示', () => {
        setSceneCues('true');
        render(<SceneCue sentences={continuous} currentSentence={continuous[1]} />);

        expect(screen.queryByTestId('scene-cue')).toBeNull();
    });
});
