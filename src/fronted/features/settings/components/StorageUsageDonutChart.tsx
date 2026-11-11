import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/fronted/lib/utils';
import type { StorageUsageCategory } from '@/common/contracts/storage-usage-vo';

/**
 * 各类用量在环形图中的取色。
 *
 * 直接引用 Astryx 主题提供的 border-* token，深浅色由主题 CSS 里的
 * light-dark() 根据 color-scheme 解析，不要在这里写死明暗两套值。
 */
const USAGE_CHART_COLORS: Record<StorageUsageCategory, string> = {
    videos: 'var(--color-border-blue)',
    favorite_clips: 'var(--color-border-orange)',
    word_clips: 'var(--color-border-green)',
    models: 'var(--color-border-purple)',
    temp: 'var(--color-border-gray)',
    other: 'var(--color-border-pink)',
};

/** 环形图的一段用量。 */
interface UsageSegment {
    category: StorageUsageCategory;
    bytes: number;
}

/** 环形图属性定义。 */
export interface StorageUsageDonutChartProps {
    /** 各分类用量，顺序即绘制顺序。 */
    segments: UsageSegment[];
    /** 所有分类的字节总和，用于计算百分比。 */
    totalBytes: number;
    /** 字节数格式化函数，与明细列表共用同一口径。 */
    formatBytes: (bytes: number) => string;
    /** 分类名称本地化函数。 */
    labelFor: (category: StorageUsageCategory) => string;
    /** 外层容器尺寸类。 */
    className?: string;
}

interface UsageTooltipProps {
    active?: boolean;
    payload?: ReadonlyArray<{ value?: number | string; name?: string | number }>;
    totalBytes: number;
    formatBytes: (bytes: number) => string;
    labelFor: (category: StorageUsageCategory) => string;
}

/**
 * 环形图悬浮提示：分类名 + 可读大小 + 占比。
 *
 * recharts 会把 active/payload 注入到 content 元素，其余属性沿用调用方传入值。
 */
const UsageTooltip: React.FC<UsageTooltipProps> = ({
    active,
    payload,
    totalBytes,
    formatBytes,
    labelFor,
}) => {
    if (!active || !payload?.length) {
        return null;
    }

    const item = payload[0];
    const value = Number(item.value ?? 0);
    const category = item.name as StorageUsageCategory;

    return (
        <div
            className={cn(
                'min-w-[8rem] rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
            )}
        >
            <div className="flex min-w-32 items-center justify-between gap-4 leading-none">
                <span className="text-muted-foreground">{labelFor(category)}</span>
                <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatBytes(value)}
                    {totalBytes > 0 && (
                        <span className="ml-2 text-muted-foreground">
                            {((value / totalBytes) * 100).toFixed(1)}%
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
};

/**
 * 存储用量环形图。
 *
 * 只负责图表本身：尺寸、明细列表与空/加载态由 StorageUsageCard 决定。
 *
 * @param props 组件属性。
 * @returns 环形图 JSX 元素。
 */
const StorageUsageDonutChart: React.FC<StorageUsageDonutChartProps> = ({
    segments,
    totalBytes,
    formatBytes,
    labelFor,
    className,
}) => {
    return (
        <div
            className={cn(
                'flex justify-center text-xs',
                '[&_.recharts-layer]:outline-none',
                '[&_.recharts-sector]:stroke-transparent [&_.recharts-sector]:outline-none',
                '[&_.recharts-surface]:outline-none',
                className,
            )}
        >
            <ResponsiveContainer>
                <PieChart>
                    <Tooltip
                        cursor={false}
                        content={
                            <UsageTooltip
                                totalBytes={totalBytes}
                                formatBytes={formatBytes}
                                labelFor={labelFor}
                            />
                        }
                    />
                    <Pie
                        data={segments}
                        dataKey="bytes"
                        nameKey="category"
                        innerRadius={50}
                        outerRadius={78}
                        paddingAngle={2}
                        strokeWidth={2}
                    >
                        {segments.map((segment) => (
                            <Cell
                                key={segment.category}
                                fill={USAGE_CHART_COLORS[segment.category]}
                            />
                        ))}
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};

export default StorageUsageDonutChart;
