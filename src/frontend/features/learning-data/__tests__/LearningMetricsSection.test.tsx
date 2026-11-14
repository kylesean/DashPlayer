import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useSWR from 'swr';

import LearningMetricsSection from '../LearningMetricsSection';
import type { LearningMetricsVO } from '@/common/types/learningMetrics';

vi.mock('swr', () => ({
    default: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            options && 'days' in options ? `${key}:${options.days}` : key,
    }),
}));

const metrics: LearningMetricsVO = {
    generatedAt: '2026-01-01T10:00:00.000Z',
    windowDays: 7,
    northStar: { key: 'weeklyRecallWords', value: 12, numerator: 12 },
    metrics: [
        { key: 'retention7', value: 0.75, numerator: 3 },
        { key: 'retention30', value: null, numerator: 0 },
        { key: 'reviewCompletion', value: 0.6, numerator: 6, denominator: 10 },
        { key: 'recommendationOpen', value: 0.3, numerator: 3, denominator: 10 },
        { key: 'feedbackRate', value: 0.5, denominator: 4 },
        { key: 'dueBacklog', value: 4 },
        { key: 'practiceCoverage', value: 0.25, denominator: 4 },
    ],
    retention: {
        last7Days: { reviewed: 3, retention: 0.75 },
        last30Days: { reviewed: 0, retention: null },
    },
    unavailable: ['interventionsPerTenMinutes', 'continueAfterSession'],
};

const mockSwr = (value: unknown) => {
    vi.mocked(useSWR).mockReturnValue(value as ReturnType<typeof useSWR>);
};

describe('LearningMetricsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('成功回忆指标单独展示，辅助指标按固定顺序渲染', () => {
        mockSwr({ data: metrics, error: undefined, isLoading: false });
        render(<LearningMetricsSection />);

        expect(screen.getByTestId('learning-metrics-north-star')).toHaveTextContent('12');
        expect(screen.getByTestId('learning-metric-retention7')).toHaveTextContent('75%');
        expect(screen.getByTestId('learning-metric-reviewCompletion')).toHaveTextContent('60%');
        expect(screen.getByTestId('learning-metric-dueBacklog')).toHaveTextContent('4');
    });

    it('没有样本的比率显示「暂无数据」而不是 0%', () => {
        mockSwr({ data: metrics, error: undefined, isLoading: false });
        render(<LearningMetricsSection />);

        expect(screen.getByTestId('learning-metric-retention30')).toHaveTextContent('noData');
        expect(screen.getByTestId('learning-metric-retention30')).not.toHaveTextContent('0%');
    });

    it('缺数据源的指标被明确列出，不混进指标卡', () => {
        mockSwr({ data: metrics, error: undefined, isLoading: false });
        render(<LearningMetricsSection />);

        expect(screen.getByTestId('learning-metrics-unavailable')).toBeInTheDocument();
        expect(screen.queryByTestId('learning-metric-interventionsPerTenMinutes')).toBeNull();
    });

    it('加载中显示骨架屏，不渲染数值', () => {
        mockSwr({ data: undefined, error: undefined, isLoading: true });
        render(<LearningMetricsSection />);

        expect(screen.getByTestId('learning-metrics-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('learning-metrics-north-star')).toBeNull();
    });

    it('请求失败时只显示可读提示，不抛错', () => {
        mockSwr({ data: undefined, error: new Error('boom'), isLoading: false });
        render(<LearningMetricsSection />);

        expect(screen.getByTestId('learning-metrics-error')).toBeInTheDocument();
        expect(screen.getByText('loadFailed')).toBeInTheDocument();
    });
});
