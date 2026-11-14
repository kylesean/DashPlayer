import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import useSWR from 'swr';

import AdaptiveChineseLine, {
    adaptiveChineseOpacityClass,
} from '../AdaptiveChineseLine';
import useSetting from '@/frontend/features/settings/settingsStore';
import type { Sentence } from '@/common/types/SentenceC';

vi.mock('swr', () => ({
    default: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => key,
        }),
    };
});

vi.mock('@/frontend/features/player/playerApi', () => ({
    playerApi: {
        subtitleComprehension: vi.fn(),
    },
}));

const sentence = {
    fileHash: 'subtitle-1',
    index: 2,
    text: 'The journey rewards serendipity.',
} as Sentence;

const mockSWR = (band?: 'high' | 'medium' | 'low') => {
    vi.mocked(useSWR).mockReturnValue({
        data: band ? { band, score: 0.9 } : undefined,
        error: null,
        isLoading: false,
        mutate: vi.fn(),
    } as unknown as ReturnType<typeof useSWR>);
};

describe('AdaptiveChineseLine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useSetting.setState({
            values: new Map([['player.adaptiveChinese', 'true']]),
        });
    });

    it('高理解度弱化中文但不隐藏文本', () => {
        mockSWR('high');
        render(
            <AdaptiveChineseLine
                sentence={sentence}
                text="旅程会奖励意外的惊喜。"
                order="second"
            />,
        );

        const line = screen.getByTestId('adaptive-chinese-line');
        expect(line.getAttribute('data-comprehension-band')).toBe('high');
        expect(line.className).toContain('opacity-[0.5]');
        expect(screen.getByText('旅程会奖励意外的惊喜。')).toBeDefined();
    });

    it('中等理解度保留更高的中文可见度', () => {
        mockSWR('medium');
        render(
            <AdaptiveChineseLine
                sentence={sentence}
                text="旅程会奖励意外的惊喜。"
                order="second"
            />,
        );

        expect(screen.getByTestId('adaptive-chinese-line').className).toContain('opacity-[0.72]');
    });

    it('关闭自适应中文后不请求理解度并保持完整显示', () => {
        useSetting.setState({
            values: new Map([['player.adaptiveChinese', 'false']]),
        });
        mockSWR('high');
        render(
            <AdaptiveChineseLine
                sentence={sentence}
                text="旅程会奖励意外的惊喜。"
                order="second"
            />,
        );

        expect(vi.mocked(useSWR).mock.calls[0][0]).toBeNull();
        expect(screen.getByTestId('adaptive-chinese-line').className).toContain('opacity-100');
    });

    it('区间到透明度的映射可独立验证', () => {
        expect(adaptiveChineseOpacityClass('high')).toContain('0.5');
        expect(adaptiveChineseOpacityClass('medium')).toContain('0.72');
        expect(adaptiveChineseOpacityClass(undefined)).toBe('opacity-100');
    });
});
