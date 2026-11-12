import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

/**
 * seek 结算契约：原生 seeked 正常结算；元素不派发 seeked 时（目标与当前位置相同，
 * 或真实 seek 超过兜底时长）由 1500ms 兜底收尾；切源后旧契约必须作废。
 *
 * jsdom 的 video.currentTime 只存值、不派发 seeked，恰好构成「seeked 永不到达」
 * 的确定性替身；`seeking` 恒为 false，samePosition 分支可用 currentTime 断言验证。
 */
describe('PlayerEngine seek 结算契约', () => {
    const resetStore = () => {
        usePlayer.setState({
            src: 'file:///tmp/seek-a.mp4',
            playing: false,
            duration: 0,
            autoPause: false,
            singleRepeat: false,
            shadowing: false,
            hoverRepeat: false,
            sentenceLoop: null,
            playbackRate: 1,
            currentSentence: null,
            seekTime: { time: 0 },
            internal: {
                exactPlayTime: 0,
                onPlaySeekTime: null,
                seekInFlight: false,
                tailPreview: null,
                timeOverride: null,
                currentLock: null,
                transientPlan: null,
                indexing: null,
            },
        });
    };

    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
    });

    afterEach(() => {
        // 先卸载再复位 store：组件还挂着时改 store 会触发未包裹的渲染更新
        cleanup();
        vi.useRealTimers();
        resetStore();
        usePlayer.setState({ src: null });
    });

    it('seeked 未派发时，200ms 防抖后写入落点，1500ms 兜底完成结算', () => {
        render(<PlayerEngine onEnded={vi.fn()} />);
        const video = screen.getByTestId('player-engine-media') as HTMLVideoElement;

        act(() => {
            usePlayer.getState().seekTo({ time: 1.5 });
        });
        expect(usePlayer.getState().internal.seekInFlight).toBe(true);

        act(() => {
            vi.advanceTimersByTime(200);
        });
        // applySeek 已把落点写入元素，但 seeked 不会到来，契约仍在途
        expect(video.currentTime).toBe(1.5);
        expect(usePlayer.getState().internal.seekInFlight).toBe(true);

        act(() => {
            vi.advanceTimersByTime(1500);
        });
        // 兜底结算：以元素当前时间收尾，解除在途标记
        expect(usePlayer.getState().internal.seekInFlight).toBe(false);
        expect(usePlayer.getState().internal.exactPlayTime).toBe(1.5);
    });

    it('原生 seeked 先到时提前结算，兜底不再重复写落点', () => {
        render(<PlayerEngine onEnded={vi.fn()} />);
        const video = screen.getByTestId('player-engine-media') as HTMLVideoElement;

        act(() => {
            usePlayer.getState().seekTo({ time: 2 });
        });
        act(() => {
            vi.advanceTimersByTime(200);
        });

        act(() => {
            video.dispatchEvent(new Event('seeked'));
        });
        expect(usePlayer.getState().internal.seekInFlight).toBe(false);
        expect(usePlayer.getState().internal.exactPlayTime).toBe(2);

        act(() => {
            vi.advanceTimersByTime(1500);
        });
        expect(usePlayer.getState().internal.exactPlayTime).toBe(2);
    });

    it('切源后旧 seek 的兜底结算不得写进新源', () => {
        render(<PlayerEngine onEnded={vi.fn()} />);

        act(() => {
            usePlayer.getState().seekTo({ time: 120 });
        });
        act(() => {
            vi.advanceTimersByTime(200);
        });

        act(() => {
            usePlayer.getState().setSource('file:///tmp/seek-b.mp4');
        });
        act(() => {
            vi.advanceTimersByTime(1600);
        });

        // 旧契约已随换源作废：旧落点 120 绝不能出现在新源的播放时间上
        expect(usePlayer.getState().src).toBe('file:///tmp/seek-b.mp4');
        expect(usePlayer.getState().internal.exactPlayTime).toBe(0);
        expect(usePlayer.getState().internal.seekInFlight).toBe(false);
    });
});

