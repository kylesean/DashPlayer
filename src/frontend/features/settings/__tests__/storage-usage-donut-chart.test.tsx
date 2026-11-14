import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StorageUsageDonutChart from '../components/StorageUsageDonutChart';

/**
 * 用替身替换 recharts 的渲染层，只校验本仓库负责的部分：
 * 分类取色、环形尺寸与 tooltip 内容/主题类。recharts 自身渲染不在本用例范围。
 */
vi.mock('recharts', async () => {
    const React = await import('react');

    const ResponsiveContainer = ({ children }: { children: React.ReactNode }) => <>{children}</>;
    const PieChart = ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>;
    const Pie = ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
        <g
            data-testid="usage-pie"
            data-inner-radius={String(props.innerRadius)}
            data-outer-radius={String(props.outerRadius)}
            data-padding-angle={String(props.paddingAngle)}
        >
            {children}
        </g>
    );
    const Cell = ({ fill }: { fill?: string }) => <path data-testid="usage-cell" data-fill={fill} />;
    const Tooltip = ({
        content,
    }: {
        content?: React.ReactElement<{ active?: boolean; payload?: unknown[] }>;
    }) =>
        content
            ? React.cloneElement(content, {
                  active: true,
                  payload: [{ value: 1024, name: 'videos' }],
              })
            : null;

    return { ResponsiveContainer, PieChart, Pie, Cell, Tooltip };
});

describe('StorageUsageDonutChart', () => {
    const renderChart = () =>
        render(
            <StorageUsageDonutChart
                segments={[
                    { category: 'videos', bytes: 1024 },
                    { category: 'word_clips', bytes: 512 },
                ]}
                totalBytes={1536}
                formatBytes={(bytes) => `${bytes} B`}
                labelFor={(category) => `label-${category}`}
            />,
        );

    it('每个分类继续使用原有的 Astryx 主题 token 取色', () => {
        renderChart();

        const fills = screen.getAllByTestId('usage-cell').map((cell) => cell.getAttribute('data-fill'));
        expect(fills).toEqual(['var(--color-border-blue)', 'var(--color-border-green)']);
    });

    it('保持环形尺寸与切片间距不变', () => {
        renderChart();

        const pie = screen.getByTestId('usage-pie');
        expect(pie).toHaveAttribute('data-inner-radius', '50');
        expect(pie).toHaveAttribute('data-outer-radius', '78');
        expect(pie).toHaveAttribute('data-padding-angle', '2');
    });

    it('tooltip 使用主题语义类并展示大小与占比', () => {
        renderChart();

        expect(screen.getByText('label-videos')).toBeInTheDocument();
        expect(screen.getByText('66.7%')).toBeInTheDocument();

        const tooltip = screen.getByText('label-videos').parentElement?.parentElement;
        expect(tooltip).toHaveClass('bg-body', 'border-border', 'text-sm');
    });
});
