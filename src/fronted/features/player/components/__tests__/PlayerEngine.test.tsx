import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PlayerEngine from '../PlayerEngine';
import { usePlayer } from '@/fronted/features/player/playerStore';

vi.mock('react-player/HtmlPlayer', () => {
    const MockHtmlPlayer = React.forwardRef<HTMLVideoElement, {
        src?: string;
        onEnded?: () => void;
    }>((props, ref) => (
        <video
            ref={ref}
            data-testid="player-engine-media"
            src={props.src}
            onEnded={props.onEnded}
        >
            <track kind="captions" />
        </video>
    ));
    MockHtmlPlayer.displayName = 'MockHtmlPlayer';
    return { default: MockHtmlPlayer };
});

describe('PlayerEngine media end', () => {
    beforeEach(() => {
        usePlayer.setState({
            src: 'file:///tmp/player-engine-test.mp4',
            playing: true,
            duration: 120,
        });
    });

    afterEach(() => {
        usePlayer.setState({
            src: null,
            playing: false,
            duration: 0,
        });
    });

    it('把 ended 收敛为暂停后再通知上层', () => {
        const onEnded = vi.fn();
        render(<PlayerEngine onEnded={onEnded} />);

        const video = screen.getByTestId('player-engine-media');
        fireEvent.ended(video);

        expect(usePlayer.getState().playing).toBe(false);
        expect(onEnded).toHaveBeenCalledTimes(1);
    });
});
