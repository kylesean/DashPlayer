import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { LearningRecapContent } from '../LearningRecapDialog';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import type {
    LearningRecapVO,
    RetellEvaluationVO,
    RolePlayTurnResultVO,
} from '@/common/types/learningRecap';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('react-hot-toast', () => ({
    toast: {
        error: vi.fn(),
    },
}));

vi.mock('@/fronted/features/learning-data/learningDataApi', () => ({
    learningDataApi: {
        getRecap: vi.fn(),
        evaluateRetell: vi.fn(),
        evaluateSpokenRetell: vi.fn(),
        evaluateRolePlayTurn: vi.fn(),
        getRolePlaySession: vi.fn(async ({ sessionKey }: { sessionKey: string }) => ({
            sessionKey,
            turns: [],
        })),
        listProductionPractice: vi.fn(async () => []),
    },
}));

// 录音 hook 依赖真实麦克风；组件测试只关心「录完之后的链路」。
const recorderStub = vi.hoisted(() => ({
    phase: 'idle' as 'idle' | 'recording' | 'processing',
    start: vi.fn(),
    stop: vi.fn(),
    /** 最近一次注册的录音完成回调，测试里直接调用它模拟「录完了」。 */
    onComplete: null as null | ((audio: Uint8Array) => Promise<void>),
}));

vi.mock('@/fronted/features/practice/usePracticeRecorder', () => ({
    usePracticeRecorder: (options: { onRecordingComplete: (audio: Uint8Array) => Promise<void> }) => {
        recorderStub.onComplete = options.onRecordingComplete;
        return {
            phase: recorderStub.phase,
            start: recorderStub.start,
            stop: recorderStub.stop,
        };
    },
}));

// 多轮对话的对方台词来自播放器当前字幕，测试里给一段最小字幕。
vi.mock('@/fronted/features/player/playerStore', () => ({
    usePlayer: (selector: (state: { sentences: unknown[] }) => unknown) => selector({
        sentences: [
            { index: 0, text: 'It was a long journey home.' },
            { index: 1, text: 'I bet you were exhausted after that drive.' },
            { index: 2, text: 'Did you stop anywhere on the way?' },
        ],
    }),
}));

const SINCE = '2026-01-01T10:00:00.000Z';

const aiRecap: LearningRecapVO = {
    since: SINCE,
    source: 'ai',
    cached: false,
    headline: '这次你真正带走了三个词。',
    words: [
        { word: 'journey', translate: '旅程', note: '记住那条回家的长路' },
        { word: 'resilient', translate: '有韧性的', note: null },
    ],
    sentence: {
        text: 'It was a long journey home.',
        note: 'journey 在这里是具体的旅程',
    },
    expression: { text: 'long journey', meaning: '漫长的旅程' },
    speakingTask: '用 30 秒讲讲你最近一次长途出行。',
    rolePlay: {
        scenario: '和朋友聊回家的路。',
        openingLine: 'It was a long journey home.',
        prompt: '回应朋友，说说你的感受。',
        targetExpressions: [{ text: 'long journey', meaning: '漫长的旅程' }],
    },
    counts: { encountered: 3, mastered: 1, due: 0, practice: 1 },
};

const renderContent = (videoId: string) => render(
    <LearningRecapContent
        videoId={videoId}
        since={SINCE}
        locale="zh-CN"
        onClose={() => undefined}
    />,
);

describe('LearningRecapContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('展示 AI 复盘的词、句、表达与口语任务', async () => {
        vi.mocked(learningDataApi.getRecap).mockResolvedValue(aiRecap);
        renderContent('video-ai');

        expect(await screen.findByText('这次你真正带走了三个词。')).toBeDefined();
        expect(screen.getByText('journey')).toBeDefined();
        expect(screen.getByText('记住那条回家的长路')).toBeDefined();
        expect(screen.getAllByText('It was a long journey home.').length).toBeGreaterThan(0);
        expect(screen.getAllByText('long journey').length).toBeGreaterThan(0);
        expect(screen.getByText('用 30 秒讲讲你最近一次长途出行。')).toBeDefined();
        expect(screen.getByText('aiBadge')).toBeDefined();
    });

    it('展示上次复述与角色扮演结果', async () => {
        vi.mocked(learningDataApi.getRecap).mockResolvedValue(aiRecap);
        vi.mocked(learningDataApi.listProductionPractice).mockResolvedValue([
            {
                id: 2,
                mode: 'roleplay',
                level: 'good',
                sentenceText: 'It was a long journey home.',
                responseText: 'It was long, but I was glad to be back.',
                feedback: null,
                improved: null,
                createdAt: '2026-01-01 10:30:00',
            },
            {
                id: 1,
                mode: 'retell',
                level: 'great',
                sentenceText: 'It was a long journey home.',
                responseText: 'The trip home was long.',
                feedback: null,
                improved: null,
                createdAt: '2026-01-01 10:20:00',
            },
        ]);
        renderContent('video-history');

        expect(await screen.findByTestId('learning-last-retell')).toBeDefined();
        expect(screen.getByTestId('learning-last-role-play')).toBeDefined();
        expect(learningDataApi.listProductionPractice).toHaveBeenCalledWith({
            videoId: 'video-history',
            fileHash: undefined,
            limit: 10,
        });
    });

    it('提交复述后展示等级、点评与更自然的说法', async () => {
        const feedback: RetellEvaluationVO = {
            level: 'good',
            feedback: '主要意思到了，补上 decided 会更完整。',
            improved: 'They chose to call off the meeting.',
            coverage: 2 / 3,
            matchedKeywords: 2,
            totalKeywords: 3,
            missingWords: ['decided'],
            source: 'ai',
            cached: false,
        };
        vi.mocked(learningDataApi.getRecap).mockResolvedValue(aiRecap);
        vi.mocked(learningDataApi.evaluateRetell).mockResolvedValue(feedback);
        renderContent('video-retell');

        const input = await screen.findByTestId('learning-retell-input');
        fireEvent.change(input, { target: { value: 'They cancelled the meeting.' } });
        fireEvent.click(screen.getByTestId('learning-retell-submit'));

        expect(await screen.findByTestId('learning-retell-feedback')).toBeDefined();
        expect(screen.getByText('levelGood')).toBeDefined();
        expect(screen.getByText('主要意思到了，补上 decided 会更完整。')).toBeDefined();
        expect(screen.getByText('They chose to call off the meeting.')).toBeDefined();
        expect(learningDataApi.evaluateRetell).toHaveBeenCalledWith({
            original: 'It was a long journey home.',
            response: 'They cancelled the meeting.',
            locale: 'zh-CN',
            videoId: 'video-retell',
            fileHash: undefined,
        });
    });

    it('本地复盘使用本地化总览、口语任务与来源标识', async () => {
        vi.mocked(learningDataApi.getRecap).mockResolvedValue({
            ...aiRecap,
            source: 'local',
            headline: '',
            speakingTask: '',
            words: aiRecap.words.map((word) => ({ ...word, note: null })),
            sentence: { text: 'It was a long journey home.', note: null },
            expression: null,
            rolePlay: {
                scenario: '',
                openingLine: 'It was a long journey home.',
                prompt: '',
                targetExpressions: [],
            },
        });
        renderContent('video-local');

        expect(await screen.findByText('localHeadline')).toBeDefined();
        expect(screen.getByText('localBadge')).toBeDefined();
        expect(screen.getByText('localSpeakingTask')).toBeDefined();
        expect(screen.getByText('rolePlayScenarioFallback')).toBeDefined();
        expect(screen.getByTestId('learning-role-play-dialogue')).toBeDefined();
    });

    it('多轮场景对话用真实字幕续接，并展示每轮点评', async () => {
        const feedback: RolePlayTurnResultVO = {
            level: 'great',
            feedback: '回应自然，而且接住了这个场景。',
            improved: 'It was a long journey, but I was glad to be home.',
            usedExpressions: ['long journey'],
            source: 'ai',
            cached: false,
            turn: 1,
            partnerIndex: 1,
        };
        vi.mocked(learningDataApi.getRecap).mockResolvedValue(aiRecap);
        vi.mocked(learningDataApi.evaluateRolePlayTurn).mockResolvedValue(feedback);
        renderContent('video-role-play');

        expect(await screen.findByTestId('learning-role-play-dialogue')).toBeDefined();
        expect(screen.getByText('和朋友聊回家的路。')).toBeDefined();
        expect(screen.getAllByText('It was a long journey home.').length).toBeGreaterThan(0);
        expect(screen.getAllByText('long journey').length).toBeGreaterThan(0);

        expect(await screen.findByTestId('learning-role-play-composer')).toBeDefined();
        const input = document.querySelector('[contenteditable="true"]') as HTMLElement;
        expect(input).not.toBeNull();
        // ChatComposer 是 contentEditable 输入：直接写入文本再派发 input 事件。
        input.textContent = 'It was a long journey, but I was glad to be home.';
        fireEvent.input(input);
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(await screen.findByText('回应自然，而且接住了这个场景。')).toBeDefined();
        expect(screen.getByText('rolePlayLevelGreat')).toBeDefined();
        expect(screen.getByText('rolePlayUsedExpressions: long journey')).toBeDefined();
        expect(learningDataApi.evaluateRolePlayTurn).toHaveBeenCalledWith(expect.objectContaining({
            scenario: '和朋友聊回家的路。',
            partnerLine: 'I bet you were exhausted after that drive.',
            partnerIndex: 1,
            response: 'It was a long journey, but I was glad to be home.',
            targetExpressions: ['long journey'],
            locale: 'zh-CN',
            videoId: 'video-role-play',
            fileHash: undefined,
        }));
    });

    it('字幕用完时对话自然结束，不再显示输入框', async () => {
        vi.mocked(learningDataApi.getRecap).mockResolvedValue({
            ...aiRecap,
            rolePlay: {
                scenario: '和朋友聊回家的路。',
                openingLine: 'Did you stop anywhere on the way?',
                prompt: '',
                targetExpressions: [],
            },
        });
        renderContent('video-role-play-end');

        expect(await screen.findByTestId('learning-role-play-dialogue')).toBeDefined();
        expect(await screen.findByText('rolePlayEnded')).toBeDefined();
        expect(screen.queryByTestId('learning-role-play-composer')).toBeNull();
    });

    it('重开弹窗时恢复已发生的轮次', async () => {
        vi.mocked(learningDataApi.getRecap).mockResolvedValue(aiRecap);
        vi.mocked(learningDataApi.getRolePlaySession).mockResolvedValueOnce({
            sessionKey: 'restored',
            turns: [{
                turn: 1,
                partnerLine: 'I bet you were exhausted after that drive.',
                partnerIndex: 1,
                response: 'I was, but I slept for twelve hours.',
                level: 'good',
                feedback: '上一轮的点评',
                improved: '',
                usedExpressions: [],
                source: 'ai',
            }],
        });
        renderContent('video-role-play-restore');

        expect(await screen.findByText('上一轮的点评')).toBeDefined();
        expect(screen.getByText('I was, but I slept for twelve hours.')).toBeDefined();
    });

    it('语音复述把转写文本回填输入框，并展示系统听到的内容', async () => {
        vi.mocked(learningDataApi.getRecap).mockResolvedValue(aiRecap);
        vi.mocked(learningDataApi.evaluateSpokenRetell).mockResolvedValue({
            level: 'good',
            feedback: '主要意思到了。',
            improved: '',
            coverage: 2 / 3,
            matchedKeywords: 2,
            totalKeywords: 3,
            missingWords: ['home'],
            source: 'local',
            cached: false,
            transcript: 'It was a long journey.',
            rhythm: null,
        });
        renderContent('video-spoken-retell');

        expect(await screen.findByTestId('learning-retell-record')).toBeDefined();
        fireEvent.click(screen.getByTestId('learning-retell-record'));
        expect(recorderStub.start).toHaveBeenCalled();

        // 模拟录音完成：转写文本应回填输入框并显示「系统听到」。
        await recorderStub.onComplete!(new Uint8Array([1, 2, 3]));
        expect(await screen.findByTestId('learning-spoken-transcript')).toBeDefined();
        expect(screen.getByText('spokenTranscript')).toBeDefined();
        expect((screen.getByTestId('learning-retell-input') as HTMLTextAreaElement).value)
            .toBe('It was a long journey.');
        expect(learningDataApi.evaluateSpokenRetell).toHaveBeenCalledWith(expect.objectContaining({
            original: 'It was a long journey home.',
            videoId: 'video-spoken-retell',
        }));
    });

    it('加载失败时展示重试入口', async () => {
        vi.mocked(learningDataApi.getRecap).mockRejectedValue(new Error('ipc failed'));
        renderContent('video-error');

        expect(await screen.findByText('loadFailed')).toBeDefined();
        expect(screen.getByText('retry')).toBeDefined();
    });
});
