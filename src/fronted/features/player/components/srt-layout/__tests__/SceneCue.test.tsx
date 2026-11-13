import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import SceneCue from '../SceneCue';
import type { Sentence } from '@/common/types/SentenceC';
import useSetting from '@/fronted/features/settings/settingsStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import { resetSceneBoundariesCache } from '@/fronted/features/player/hooks/useSceneBoundaries';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        getSceneBoundaries: vi.fn(),
    },
}));

const mockedBoundaries = vi.mocked(playerApi.getSceneBoundaries);

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
        resetSceneBoundariesCache();
        setSceneCues('false');
        mockedBoundaries.mockReset();
        mockedBoundaries.mockResolvedValue([]);
    });

    it('开关关闭时不展示提示', () => {
        render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[2]} />);

        expect(screen.queryByTestId('scene-cue')).toBeNull();
        expect(mockedBoundaries).not.toHaveBeenCalled();
    });

    it('开关开启且命中高置信度换人时展示提示', async () => {
        setSceneCues('true');
        mockedBoundaries.mockResolvedValue([{
            sentenceIndex: 2,
            atSec: 4,
            kinds: ['speaker-shift'],
            confidence: 0.85,
        }]);
        render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[2]} />);

        await waitFor(() => {
            expect(screen.getByTestId('scene-cue').textContent).toBe('sceneCue.speakerShift');
        });
        expect(mockedBoundaries).toHaveBeenCalledTimes(1);
    });

    it('低置信度纯文本换人猜测与单纯韵律/画面变化不在主字幕上方弹窗', async () => {
        setSceneCues('true');
        mockedBoundaries.mockResolvedValue([
            {
                sentenceIndex: 1,
                atSec: 2,
                kinds: ['speaker-shift'],
                confidence: 0.45,
            },
            {
                sentenceIndex: 2,
                atSec: 4,
                kinds: ['prosody-shift'],
                confidence: 0.7,
            },
        ]);
        const { rerender } = render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[1]} />);

        await waitFor(() => {
            expect(mockedBoundaries).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByTestId('scene-cue')).toBeNull();

        rerender(<SceneCue sentences={withBoundary} currentSentence={withBoundary[2]} />);
        expect(screen.queryByTestId('scene-cue')).toBeNull();
    });

    it('多信号包含高置信度换人时展示换人提示', async () => {
        setSceneCues('true');
        mockedBoundaries.mockResolvedValue([{
            sentenceIndex: 2,
            atSec: 4,
            kinds: ['prosody-shift', 'visual-shift', 'speaker-shift'],
            confidence: 0.85,
        }]);
        render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[2]} />);

        await waitFor(() => {
            expect(screen.getByTestId('scene-cue').textContent).toBe('sceneCue.speakerShift');
        });
    });

    it('普通连续字幕不展示提示', async () => {
        setSceneCues('true');
        render(<SceneCue sentences={continuous} currentSentence={continuous[1]} />);

        await waitFor(() => {
            expect(mockedBoundaries).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByTestId('scene-cue')).toBeNull();
    });

    it('后端失败时静默隐藏，不回退到前端重算', async () => {
        setSceneCues('true');
        mockedBoundaries.mockRejectedValue(new Error('ipc unavailable'));
        render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[2]} />);

        await waitFor(() => {
            expect(mockedBoundaries).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByTestId('scene-cue')).toBeNull();
    });

    it('只把影响切分的字段发给后端', async () => {
        setSceneCues('true');
        render(<SceneCue sentences={withBoundary} currentSentence={withBoundary[0]} />);

        await waitFor(() => {
            expect(mockedBoundaries).toHaveBeenCalledTimes(1);
        });
        expect(mockedBoundaries).toHaveBeenCalledWith([
            { fileHash: 'hash', index: 0, start: 0, end: 2, text: 'The journey starts tomorrow morning.' },
            { fileHash: 'hash', index: 1, start: 2, end: 4, text: 'Are you ready for the journey?' },
            { fileHash: 'hash', index: 2, start: 4, end: 4.6, text: 'Yes.' },
        ], undefined);
    });
});
