import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { transcribeAudioMock, getResourceStatusMock } = vi.hoisted(() => ({
    transcribeAudioMock: vi.fn(),
    getResourceStatusMock: vi.fn().mockResolvedValue({ transcription: { ready: true } }),
}));

vi.mock('swr', () => ({
    default: () => ({ data: { transcription: { ready: true } } }),
}));

vi.mock('@/fronted/features/settings/settingsApi', () => ({
    settingsApi: {
        getResourceStatus: getResourceStatusMock,
    },
}));

vi.mock('@/fronted/features/chat/chatApi', () => ({
    chatApi: {
        transcribeAudio: transcribeAudioMock,
    },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useWhisperDictation } from '@/fronted/features/chat/useWhisperDictation';

describe('useWhisperDictation 显式状态机与竞态收敛', () => {
    const originalMediaDevices = navigator.mediaDevices;
    const originalMediaRecorder = globalThis.MediaRecorder;

    class MockMediaRecorder {
        public static isTypeSupported = () => true;
        public state: 'inactive' | 'recording' = 'inactive';
        public ondataavailable: ((ev: { data: Blob }) => void) | null = null;
        public onstop: (() => void) | null = null;

        public start() {
            this.state = 'recording';
        }

        public stop() {
            if (this.state === 'inactive') return;
            this.state = 'inactive';
            this.ondataavailable?.({
                data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
            });
            this.onstop?.();
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder =
            MockMediaRecorder as unknown as typeof MediaRecorder;
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: originalMediaDevices,
        });
        (globalThis as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder = originalMediaRecorder;
    });

    it('getUserMedia 请求权限窗口期重复 start 只打开一条流，且期间 abort 会停掉迟到音轨', async () => {
        let resolveStream!: (stream: MediaStream) => void;
        const stopTrack = vi.fn();
        const fakeStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
        const getUserMedia = vi.fn().mockImplementation(
            () => new Promise<MediaStream>((resolve) => {
                resolveStream = resolve;
            }),
        );
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });

        const { result } = renderHook(() =>
            useWhisperDictation({ onTranscriptReady: vi.fn() }),
        );

        act(() => {
            result.current.start();
            result.current.start();
        });

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(result.current.phase).toBe('requesting');
        expect(result.current.isRequesting).toBe(true);
        expect(result.current.isBusy).toBe(true);

        // 在 getUserMedia 返回前中止：迟到流必须立即释放所有 track，且保持 idle
        act(() => {
            result.current.abort();
        });
        expect(result.current.phase).toBe('idle');

        await act(async () => {
            resolveStream(fakeStream);
            await Promise.resolve();
        });

        expect(stopTrack).toHaveBeenCalledTimes(1);
        expect(result.current.phase).toBe('idle');
    });

    it('transcribeAudio 在途期间 abort 不得把迟到转写结果写回 onTranscriptReady', async () => {
        let resolveTranscribe!: (res: { text: string }) => void;
        transcribeAudioMock.mockImplementation(
            () => new Promise<{ text: string }>((resolve) => {
                resolveTranscribe = resolve;
            }),
        );

        const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
        });

        const onTranscriptReady = vi.fn();
        const { result } = renderHook(() =>
            useWhisperDictation({ onTranscriptReady }),
        );

        await act(async () => {
            result.current.start();
            await Promise.resolve();
        });
        expect(result.current.phase).toBe('listening');

        await act(async () => {
            result.current.stop();
        });
        await vi.waitFor(() => expect(transcribeAudioMock).toHaveBeenCalledTimes(1));
        expect(result.current.phase).toBe('transcribing');

        act(() => {
            result.current.abort();
        });
        expect(result.current.phase).toBe('idle');

        await act(async () => {
            resolveTranscribe({ text: 'late transcript' });
            await Promise.resolve();
        });

        expect(onTranscriptReady).not.toHaveBeenCalled();
        expect(result.current.phase).toBe('idle');
    });
});
