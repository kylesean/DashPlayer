import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import usePracticePanel from '@/frontend/features/practice/practiceStore';
import { usePlayer } from '@/frontend/features/player/playerStore';
import PracticePanel from '@/frontend/features/practice/PracticePanel';

vi.mock('@/frontend/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/frontend/features/practice/practiceApi', () => ({
    practiceApi: {
        ensureMicrophone: vi.fn().mockResolvedValue('granted'),
        scoreShadowing: vi.fn(),
        scoreDictation: vi.fn(),
        listBySentence: vi.fn().mockResolvedValue([]),
        listByFile: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock('@/frontend/features/settings/settingsApi', () => ({
    settingsApi: {
        getResourceStatus: vi.fn().mockResolvedValue({ transcription: { ready: true } }),
    },
}));

vi.mock('@/frontend/features/player/components/PlayerActions', () => ({
    playerActions: {
        pause: vi.fn(),
        gotoSentence: vi.fn(),
        play: vi.fn(),
        playPracticeClip: vi.fn(),
        clearPracticeClip: vi.fn(),
        seekToTarget: vi.fn(),
        setShadowing: vi.fn(),
    },
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
        }),
    };
});

// 面板用 SWR 拉取资源状态与练习历史；这里返回静态数据，避免真实网络与缓存行为干扰。
vi.mock('swr', () => ({
    mutate: vi.fn(),
    default: (key: unknown) => {
        if (Array.isArray(key) && String(key[0]).includes('practice/list-by-sentence')) {
            return { data: [], mutate: vi.fn() };
        }
        if (Array.isArray(key) && String(key[0]).includes('practice/list-by-file')) {
            return { data: [], mutate: vi.fn() };
        }
        return { data: { transcription: { ready: true } }, mutate: vi.fn() };
    },
}));

/** 最小可用的 MediaRecorder 替身。 */
class FakeMediaRecorder {
    public static instances: FakeMediaRecorder[] = [];
    public static isTypeSupported(): boolean {
        return true;
    }
    public state: 'inactive' | 'recording' = 'inactive';
    public mimeType = 'audio/webm';
    public ondataavailable: ((event: { data: Blob }) => void) | null = null;
    public onstop: (() => void) | null = null;

    public constructor() {
        FakeMediaRecorder.instances.push(this);
    }

    public start(): void {
        this.state = 'recording';
    }

    public stop(): void {
        this.state = 'inactive';
        this.onstop?.();
    }
}

/** 构造一条可用于练习的最小字幕句。 */
const buildSentence = () => ({
    fileHash: 'hash',
    index: 0,
    start: 0,
    end: 2,
    adjustedStart: null,
    adjustedEnd: null,
    text: 'hello world',
    textZH: '',
    key: 'hash-0',
    transGroup: 1,
    translationKey: 'hash:0',
    struct: { original: 'hello world', blocks: [] },
});

describe('PracticePanel 录音与页签切换（真实调用路径）', () => {
    beforeEach(() => {
        FakeMediaRecorder.instances = [];
        vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
        });
        usePracticePanel.setState({ visible: true, mode: 'shadowing' });
        usePlayer.setState({ currentSentence: buildSentence() as never });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        usePracticePanel.setState({ visible: false, mode: 'shadowing' });
    });

    it('录音中点「听写」页签后，麦克风停止且 recording 归位', async () => {
        render(<PracticePanel />);

        // 录音按钮：录音态下文案为 "recorder.stop"
        const startButton = await screen.findByText('recorder.start');
        await act(async () => {
            startButton.closest('button')!.click();
        });
        await waitFor(() => expect(usePracticePanel.getState().recorderPhase).toBe('recording'));
        expect(FakeMediaRecorder.instances[0].state).toBe('recording');

        // 切到听写页签：走面板真实的 setMode 调用路径
        const dictationTab = screen.getByText('panel.tabDictation');
        await act(async () => {
            dictationTab.closest('button')!.click();
        });

        await waitFor(() => {
            expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
            expect(usePracticePanel.getState().recorderPhase).toBe('idle');
        });
    });
});
