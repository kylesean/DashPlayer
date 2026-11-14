import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backendClient } from '@/frontend/infrastructure/electron/backendClient';
import { playContextAudio, playWord, stopActiveAudio } from '@/frontend/infrastructure/audio/AudioPlayer';

vi.mock('@/frontend/infrastructure/electron/backendClient', () => ({
    backendClient: {
        call: vi.fn(),
    },
}));

vi.mock('@/frontend/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('AudioPlayer epoch preemption', () => {
    const speakMock = vi.fn();
    const cancelMock = vi.fn();
    const audioPlayMock = vi.fn(async () => undefined);
    const audioPauseMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        stopActiveAudio();

        Object.defineProperty(window, 'speechSynthesis', {
            configurable: true,
            value: {
                speak: speakMock,
                cancel: cancelMock,
            },
        });
        vi.stubGlobal('SpeechSynthesisUtterance', class MockUtterance {
            text: string;
            lang = '';
            rate = 1;
            constructor(text: string) {
                this.text = text;
            }
        });
        vi.stubGlobal('Audio', class MockAudio {
            volume = 1;
            play = audioPlayMock;
            pause = audioPauseMock;
        });
    });

    it('stopActiveAudio 会终止浏览器语音合成并递增值代数，丢弃过期的 TTS/回退播放', async () => {
        let resolveTts!: (value: string) => void;
        vi.mocked(backendClient.call).mockImplementation(
            () => new Promise<string>((resolve) => {
                resolveTts = resolve;
            }),
        );

        const pendingPlay = playContextAudio({ text: 'apple' });
        stopActiveAudio();
        expect(cancelMock).toHaveBeenCalledTimes(2);

        resolveTts('https://example.invalid/tts/apple.mp3');
        await pendingPlay;

        expect(audioPlayMock).not.toHaveBeenCalled();
        expect(speakMock).not.toHaveBeenCalled();
    });

    it('playWord 先清理前序语音后再朗读目标单词', async () => {
        await playWord('banana');

        expect(cancelMock).toHaveBeenCalled();
        expect(speakMock).toHaveBeenCalledTimes(1);
    });
});
