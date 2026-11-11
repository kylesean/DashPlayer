import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { LearningRecapContent } from '../LearningRecapDialog';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import type { LearningRecapVO, RetellEvaluationVO } from '@/common/types/learningRecap';

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
    },
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
        expect(screen.getByText('It was a long journey home.')).toBeDefined();
        expect(screen.getByText('long journey')).toBeDefined();
        expect(screen.getByText('用 30 秒讲讲你最近一次长途出行。')).toBeDefined();
        expect(screen.getByText('aiBadge')).toBeDefined();
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
        });
        renderContent('video-local');

        expect(await screen.findByText('localHeadline')).toBeDefined();
        expect(screen.getByText('localBadge')).toBeDefined();
        expect(screen.getByText('localSpeakingTask')).toBeDefined();
    });

    it('加载失败时展示重试入口', async () => {
        vi.mocked(learningDataApi.getRecap).mockRejectedValue(new Error('ipc failed'));
        renderContent('video-error');

        expect(await screen.findByText('loadFailed')).toBeDefined();
        expect(screen.getByText('retry')).toBeDefined();
    });
});
