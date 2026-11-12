import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useWatchPlayer } from '@/mobile/useWatchPlayer';
import VideoBar from '@/mobile/VideoBar';
import { mobileApi } from '@/mobile/api';
import type { MobileWatchDetail } from '@/common/contracts/mobile-web';

vi.mock('@/mobile/api', () => ({
    mobileApi: {
        saveProgress: vi.fn().mockResolvedValue(undefined),
        translateTexts: vi.fn(),
        lookupWord: vi.fn(),
    },
}));

const makeDetail = (lineCount = 35): MobileWatchDetail => ({
    id: 'video-mobile-1',
    title: 'Sample Episode',
    subtitle: 'Season 1',
    isAudio: false,
    streamUrl: 'https://example.invalid/stream.mp4',
    currentPosition: 0,
    subtitleMismatchSuspected: false,
    subtitles: Array.from({ length: lineCount }, (_, index) => ({
        start: index * 2,
        end: index * 2 + 1.8,
        en: `Line ${index} content`,
        zh: '',
    })),
});

describe('mobile player & VideoBar state machines', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        localStorage.clear();
        vi.mocked(mobileApi.translateTexts).mockImplementation(async (texts) => texts.map((text) => `译:${text}`));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('先跳到后段字幕再回跳到开头，仍能为早期字幕请求翻译', async () => {
        const detail = makeDetail(35);
        const { result } = renderHook(() => useWatchPlayer(detail));

        // 挂载一个只读 currentTime 的 mock video 元素
        const mockVideo = {
            currentTime: 50,
            duration: 100,
            playbackRate: 1,
            paused: false,
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
            removeAttribute: vi.fn(),
            load: vi.fn(),
        } as unknown as HTMLVideoElement;
        result.current.videoRef.current = mockVideo;

        // 播放先停在第 25 句（t = 50），覆盖 [23..35)
        act(() => {
            result.current.handleLoadedMetadata();
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(mobileApi.translateTexts).toHaveBeenCalledTimes(1);

        // 回跳到第 0 句（t = 0）：仍需为前面未翻译区间请求翻译
        mockVideo.currentTime = 0;
        act(() => {
            result.current.seekTo(0);
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(mobileApi.translateTexts).toHaveBeenCalledTimes(2);
        const secondBatch = vi.mocked(mobileApi.translateTexts).mock.calls[1]?.[0];
        expect(secondBatch).toContain('Line 0 content');
    });

    it('翻译失败后关闭再重新打开翻译开关，会重置已尝试集合并重试拉取', async () => {
        vi.mocked(mobileApi.translateTexts)
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValueOnce(['译:Line 0 content']);

        const detail = makeDetail(1);
        const { result } = renderHook(() => useWatchPlayer(detail));
        const mockVideo = {
            currentTime: 0.5,
            duration: 10,
            playbackRate: 1,
            paused: false,
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
            removeAttribute: vi.fn(),
            load: vi.fn(),
        } as unknown as HTMLVideoElement;
        result.current.videoRef.current = mockVideo;

        act(() => {
            result.current.handleLoadedMetadata();
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mobileApi.translateTexts).toHaveBeenCalledTimes(1);
        expect(result.current.currentTranslation).toBe('');

        // 关闭再开启翻译，应重置失败记录并重新拉取
        act(() => {
            result.current.toggleTranslation();
        });
        act(() => {
            result.current.toggleTranslation();
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mobileApi.translateTexts).toHaveBeenCalledTimes(2);
        expect(result.current.currentTranslation).toBe('译:Line 0 content');
    });

    it('VideoBar 在拖动期间若被禁用或时长清零，不再用陈旧 scrub 遮盖真实播放进度', () => {
        const onSeek = vi.fn();
        const { rerender } = render(
            <VideoBar
                paused={false}
                position={10}
                duration={100}
                disabled={false}
                onTogglePlay={vi.fn()}
                onSeek={onSeek}
                onFullscreen={vi.fn()}
            />,
        );

        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '45' } });
        expect(screen.getByText(/0:45/)).toBeDefined();

        // 控件切换为 disabled 时回退显示真实 position 0:10
        rerender(
            <VideoBar
                paused={false}
                position={10}
                duration={100}
                disabled={true}
                onTogglePlay={vi.fn()}
                onSeek={onSeek}
                onFullscreen={vi.fn()}
            />,
        );
        expect(screen.getByText(/0:10/)).toBeDefined();
        expect(screen.queryByText(/0:45/)).toBeNull();
    });
});
