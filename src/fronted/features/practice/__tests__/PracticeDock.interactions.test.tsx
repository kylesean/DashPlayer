import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sentence } from '@/common/types/SentenceC';
import { practiceApi } from '@/fronted/features/practice/practiceApi';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { useTrainingModeStore } from '@/fronted/features/player/trainingStore';
import PracticePanel from '@/fronted/features/practice/PracticePanel';

const mockAsrReady = { value: true };
const mockFileSummaries = {
    value: [
        {
            sentenceIndex: 0,
            bestScore: 60,
            attemptCount: 1,
            lastMode: 'dictation' as const,
            lastPracticedAt: '2026-11-12 01:00:00',
        },
    ],
};

const { mockPlayerActions } = vi.hoisted(() => ({
    mockPlayerActions: {
        pause: vi.fn(),
        play: vi.fn(),
        gotoSentence: vi.fn(),
        seekToTarget: vi.fn(),
        playPracticeClip: vi.fn(),
        clearPracticeClip: vi.fn(),
        setShadowing: vi.fn(),
        nextSentence: vi.fn(),
    },
}));

vi.mock('@/fronted/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/fronted/features/practice/practiceApi', () => ({
    practiceApi: {
        ensureMicrophone: vi.fn().mockResolvedValue('granted'),
        scoreShadowing: vi.fn(),
        scoreDictation: vi.fn().mockResolvedValue({
            score: 100,
            transcript: 'hello world',
            words: [
                { expected: 'hello', heard: 'hello', status: 'match' },
                { expected: 'world', heard: 'world', status: 'match' },
            ],
            audioPath: null,
        }),
        listBySentence: vi.fn().mockResolvedValue([]),
        listByFile: vi.fn().mockImplementation(() => Promise.resolve(mockFileSummaries.value)),
    },
}));

vi.mock('@/fronted/features/settings/settingsApi', () => ({
    settingsApi: {
        getResourceStatus: vi.fn().mockImplementation(() =>
            Promise.resolve({ transcription: { ready: mockAsrReady.value } }),
        ),
    },
}));

vi.mock('@/fronted/features/player/components/PlayerActions', () => ({
    playerActions: mockPlayerActions,
}));

vi.mock('@/fronted/features/player/components/translatable-line/word', () => ({
    default: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-hot-toast', () => {
    const fn = Object.assign(vi.fn(), {
        error: vi.fn(),
        success: vi.fn(),
    });
    return { default: fn };
});

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, options?: { defaultValue?: string; [k: string]: unknown }) => {
                let text = options?.defaultValue ?? key;
                if (options) {
                    for (const [k, v] of Object.entries(options)) {
                        if (k === 'defaultValue') continue;
                        text = text.replace(`{{${k}}}`, String(v));
                    }
                }
                return text;
            },
        }),
    };
});

vi.mock('swr', () => ({
    mutate: vi.fn(),
    default: (key: unknown) => {
        if (Array.isArray(key) && String(key[0]).includes('practice/list-by-file')) {
            return { data: mockFileSummaries.value, mutate: vi.fn() };
        }
        if (Array.isArray(key) && String(key[0]).includes('practice/list-by-sentence')) {
            return { data: [], mutate: vi.fn() };
        }
        return { data: { transcription: { ready: mockAsrReady.value } }, mutate: vi.fn() };
    },
}));

vi.mock('@/fronted/features/video-learning/videoLearningApi', () => ({
    videoLearningApi: {
        recordWordEncounter: vi.fn().mockResolvedValue(undefined),
    },
}));

const makeSentence = (index: number, text: string): Sentence => ({
    fileHash: 'hash-1',
    index,
    start: index * 3,
    end: index * 3 + 2,
    adjustedStart: null,
    adjustedEnd: null,
    text,
    textZH: `中文 ${index}`,
    key: `hash-1-${index}`,
    transGroup: 1,
    translationKey: `hash-1:${index}`,
    struct: { original: text, blocks: [] },
});

describe('PracticeDock 重构工坊核心交互', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAsrReady.value = true;
        const s0 = makeSentence(0, 'hello world');
        const s1 = makeSentence(1, "It's fine today.");
        usePlayer.setState({
            sentences: [s0, s1],
            currentSentence: s0,
            playing: false,
            shadowing: false,
            shadowingPause: null,
        });
        useTrainingModeStore.setState({
            config: { shadowingRatio: 1.5, repeatTimes: 3, progressiveRates: [0.75, 1, 1.25] },
        });
        usePracticePanel.setState({
            visible: true,
            mode: 'dictation',
            dictationStyle: 'slots',
            shadowingStyle: 'record',
            focusMode: false,
            soundCues: false,
            sentenceFilter: 'all',
            dictationRevealed: false,
            peekingSpoiler: false,
        });
    });

    afterEach(() => {
        cleanup();
        usePracticePanel.setState({ visible: false, focusMode: false, sentenceFilter: 'all' });
    });

    it('词槽即时听写：空格校验推进词槽，/ 提示首字母，末词自动提交评分', async () => {
        render(<PracticePanel />);

        const input = screen.getByLabelText('dictation.placeholder') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'hello' } });
        fireEvent.keyDown(input, { key: ' ' });

        // 首词通过后切到第二槽（world），按 / 提示首字母 'w'
        const slot1Input = await waitFor(() => {
            const el = screen.getByLabelText('dictation.placeholder') as HTMLInputElement;
            expect(el).not.toBe(input);
            return el;
        });
        expect(slot1Input.value).toBe('');
        fireEvent.keyDown(slot1Input, { key: '/' });
        expect(slot1Input.value).toBe('w');

        // 补全 'world' 并按空格：末词解锁后自动调用 scoreDictation
        fireEvent.change(slot1Input, { target: { value: 'world' } });
        await act(async () => {
            fireEvent.keyDown(slot1Input, { key: ' ' });
        });

        await waitFor(() => {
            expect(practiceApi.scoreDictation).toHaveBeenCalledWith(
                expect.objectContaining({
                    sentenceIndex: 0,
                    typedText: 'hello world',
                    expectedText: 'hello world',
                }),
            );
        });
    });

    it('词槽听写拼错词后按空格不卡死，保留误拼并自动跳下一词；尾随空格同步触发推进', async () => {
        render(<PracticePanel />);

        const input0 = screen.getByLabelText('dictation.placeholder') as HTMLInputElement;
        // 拼错第一个词按空格：仍应跳到第二个词（value 清空进入第 2 槽）
        fireEvent.change(input0, { target: { value: 'helo' } });
        fireEvent.keyDown(input0, { key: ' ' });

        await waitFor(() => {
            const input1 = screen.getByLabelText('dictation.placeholder') as HTMLInputElement;
            expect(input1.value).toBe('');
        });

        // 模拟输入法在 onChange 直接带入尾随空格：同样提交第 2 词但不因第 1 词误拼而报错阻止
        const input1 = screen.getByLabelText('dictation.placeholder') as HTMLInputElement;
        fireEvent.change(input1, { target: { value: 'world ' } });

        // 点击 提交评分 会携带第 1 词草稿 + 第 2 词正解提交
        await act(async () => {
            fireEvent.click(screen.getByText('dictation.submit'));
        });
        expect(practiceApi.scoreDictation).toHaveBeenCalledWith(
            expect.objectContaining({
                typedText: 'helo world',
            }),
        );
    });

    it('支持切换到整句盲听挑战并在 Enter 提交后显示内联差异', async () => {
        render(<PracticePanel />);

        fireEvent.click(screen.getByText('整句盲听'));
        expect(usePracticePanel.getState().dictationStyle).toBe('blind');

        const textarea = screen.getByLabelText('dictation.placeholder') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello world' } });
        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter' });
        });

        await waitFor(() => {
            expect(practiceApi.scoreDictation).toHaveBeenCalledTimes(1);
            expect(screen.getByText('得分 100')).toBeDefined();
        });
    });

    it('跟读模式下未装本地 ASR 模型仍允许录音（优雅降级，不锁定按钮）', () => {
        mockAsrReady.value = false;
        usePracticePanel.setState({ mode: 'shadowing', shadowingStyle: 'record' });
        render(<PracticePanel />);

        const micBtn = screen.getByText('recorder.start').closest('button')!;
        expect(micBtn).not.toBeDisabled();
        expect(screen.getByText(/未安装语音识别模型/)).toBeDefined();
    });

    it('切换跟读「节拍流」时自动接管播放器影子留白模式并可调整倍率', () => {
        usePracticePanel.setState({ mode: 'shadowing', shadowingStyle: 'record' });
        render(<PracticePanel />);

        fireEvent.click(screen.getByText('节拍流'));
        expect(mockPlayerActions.setShadowing).toHaveBeenCalledWith(true);

        fireEvent.click(screen.getByLabelText('延长停顿倍率'));
        expect(useTrainingModeStore.getState().config.shadowingRatio).toBe(1.7);

        // 留白倒计时期间虽然 playing=false，按钮应显示暂停而非开始
        act(() => {
            usePlayer.setState({ shadowingPause: { durationMs: 3000, untilTs: Date.now() + 3000 } });
        });
        expect(screen.getByText('panel.stop')).toBeDefined();
    });

    it('支持切换专注态与按筛选队列计数（全部/未练/低分）', async () => {
        render(<PracticePanel />);

        const focusBtn = screen.getByLabelText('切换专注模式');
        fireEvent.click(focusBtn);
        expect(usePracticePanel.getState().focusMode).toBe(true);

        // 打开队列筛选气泡（2句中第0句60分 -> 低分1，未练1）
        fireEvent.click(screen.getByText('1/2'));
        expect(await screen.findByText('未练')).toBeDefined();
        expect(screen.getByText('低分')).toBeDefined();

        fireEvent.click(screen.getByText('未练'));
        expect(usePracticePanel.getState().sentenceFilter).toBe('unpracticed');
        expect(screen.getByText('1/1')).toBeDefined();
    });
});
