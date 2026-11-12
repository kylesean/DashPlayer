import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import WordContextInsight from '@/fronted/features/player/components/translatable-line/word-context-insight';
import { playerApi } from '@/fronted/features/player/playerApi';
import useSetting from '@/fronted/features/settings/settingsStore';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('@/fronted/features/player/playerApi', () => ({
    playerApi: {
        wordContextInsight: vi.fn(),
    },
}));

const setDictionaryEngine = (engine: string) => {
    useSetting.setState({
        values: new Map([['providers.dictionary', engine]]),
    });
};

describe('WordContextInsight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setDictionaryEngine('openai');
    });

    it('默认只展示一行入口，点击后才请求并展示含义与语境说明', async () => {
        vi.mocked(playerApi.wordContextInsight).mockResolvedValue({
            status: 'ok',
            insight: {
                meaning: '取消（会议）',
                nuance: '及物动词，语气中性',
                source: 'cloud',
                cached: false,
            },
        });
        render(
            <WordContextInsight
                word="cancel"
                sentence="Please cancel the meeting."
                definitions={['v. 取消']}
            />,
        );

        expect(playerApi.wordContextInsight).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('word-context-insight-trigger'));

        expect(await screen.findByText('取消（会议）')).toBeDefined();
        expect(screen.getByText('及物动词，语气中性')).toBeDefined();
        expect(playerApi.wordContextInsight).toHaveBeenCalledWith({
            word: 'cancel',
            sentence: 'Please cancel the meeting.',
            definitions: ['v. 取消'],
        });
    });

    /**
     * §6.2 第 1 项：词卡先给「当前句子，目标词高亮」。用户点开词卡时眼睛要立刻
     * 落在目标词上，而不是自己去一行文字里找。
     */
    it('在语境原句里高亮目标词', async () => {
        vi.mocked(playerApi.wordContextInsight).mockResolvedValue({
            status: 'ok',
            insight: {
                meaning: '取消（会议）',
                nuance: '',
                source: 'cloud',
                cached: false,
            },
        });
        const { container } = render(
            <WordContextInsight
                word="cancel"
                sentence="Please cancel the meeting, then cancel the room."
                definitions={['v. 取消']}
            />,
        );

        fireEvent.click(screen.getByTestId('word-context-insight-trigger'));
        await screen.findByText('取消（会议）');

        const marks = container.querySelectorAll('mark');
        expect(marks).toHaveLength(2);
        expect(marks[0].textContent).toBe('cancel');
    });

    it('词典 AI 关闭时不渲染入口', () => {
        setDictionaryEngine('none');
        render(
            <WordContextInsight
                word="cancel"
                sentence="Please cancel the meeting."
                definitions={['v. 取消']}
            />,
        );

        expect(screen.queryByTestId('word-context-insight-trigger')).toBeNull();
    });

    it('模型未就绪时给出局部降级提示，不阻塞词卡其余内容', async () => {
        vi.mocked(playerApi.wordContextInsight).mockResolvedValue({
            status: 'unavailable',
            reason: 'model-unavailable',
        });
        render(
            <WordContextInsight
                word="cancel"
                sentence="Please cancel the meeting."
                definitions={[]}
            />,
        );

        fireEvent.click(screen.getByTestId('word-context-insight-trigger'));

        expect(await screen.findByTestId('word-context-insight-unavailable')).toBeDefined();
    });

    it('请求失败时展示重试入口', async () => {
        vi.mocked(playerApi.wordContextInsight).mockRejectedValue(new Error('ipc failed'));
        render(
            <WordContextInsight
                word="reschedule"
                sentence="We need to reschedule the meeting."
                definitions={['v. 重新安排']}
            />,
        );

        fireEvent.click(screen.getByTestId('word-context-insight-trigger'));

        expect(await screen.findByTestId('word-context-insight-error')).toBeDefined();
        expect(screen.getByText('aiContextInsightRetry')).toBeDefined();
    });
});
