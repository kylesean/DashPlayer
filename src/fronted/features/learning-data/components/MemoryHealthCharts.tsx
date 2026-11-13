import { useTranslation } from 'react-i18next';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { AlertTriangle, CalendarClock, TrendingDown } from 'lucide-react';

import type { MemoryHealthOverviewVO } from '@/common/types/memoryMap';
import { cn } from '@/fronted/lib/utils';

interface MemoryHealthChartsProps {
    overview: MemoryHealthOverviewVO;
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 112;
const PAD_LEFT = 28;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const MAX_DAYS = 30;

/**
 * 记忆全景双栏诊断图：
 * 1. FSRS 理论遗忘衰减曲线 + 实时回忆概率水位分布；
 * 2. 未来 14 天到期复习负荷预测柱状图。
 *
 * 严格使用 currentColor 与语义 Token，确保所有主题下高对比可读。
 */
export function MemoryHealthCharts({ overview }: MemoryHealthChartsProps) {
    const { t } = useTranslation(['memoryMap', 'common']);
    const { retrievabilityBuckets: buckets, leechCount, avgStabilityDays, forecastDays, decayCurve } = overview;

    const totalCategorized =
        buckets.danger + buckets.fading + buckets.stable + buckets.unreviewed;

    const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
    const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

    const toX = (day: number) => PAD_LEFT + (Math.min(MAX_DAYS, Math.max(0, day)) / MAX_DAYS) * plotW;
    const toY = (retention: number) => PAD_TOP + (1 - Math.min(1, Math.max(0, retention))) * plotH;

    const polylinePoints = decayCurve
        .map((pt) => `${toX(pt.day).toFixed(1)},${toY(pt.retention).toFixed(1)}`)
        .join(' ');
    const areaPath =
        decayCurve.length > 0
            ? `M ${toX(decayCurve[0].day).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)} ` +
              decayCurve.map((pt) => `L ${toX(pt.day).toFixed(1)},${toY(pt.retention).toFixed(1)}`).join(' ') +
              ` L ${toX(decayCurve[decayCurve.length - 1].day).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)} Z`
            : '';

    const thresholdY = toY(0.85);
    const maxForecast = Math.max(1, ...forecastDays.map((d) => d.dueCount));
    const total14DayDue = forecastDays.reduce((sum, d) => sum + d.dueCount, 0);

    return (
        <div
            data-testid="memory-health-charts"
            className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        >
            {/* 左卡：遗忘曲线与实时记忆水位 */}
            <Card variant="default" padding={4}>
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <TrendingDown className="w-4 h-4 text-accent shrink-0" />
                            <Text type="body" weight="semibold">
                                {t('forgettingCurveTitle', { defaultValue: '遗忘曲线与记忆水位' })}
                            </Text>
                        </div>
                        <span className="text-metadata text-secondary tabular-nums">
                            {avgStabilityDays !== null
                                ? t('avgStability', {
                                    days: avgStabilityDays,
                                    defaultValue: `平均稳定度 ${avgStabilityDays} 天`,
                                })
                                : t('noStabilityYet', { defaultValue: '暂无稳定度样本' })}
                        </span>
                    </div>

                    {/* 实时记忆分布条 */}
                    <div className="flex flex-col gap-1.5">
                        <div
                            className="flex h-2 w-full overflow-hidden rounded-full bg-muted/60"
                            role="img"
                            aria-label={t('healthDistributionLabel', { defaultValue: '记忆水位分布' })}
                        >
                            {totalCategorized > 0 && (
                                <>
                                    {buckets.danger > 0 && (
                                        <span
                                            className="h-full bg-warning-text/80"
                                            style={{ width: `${(buckets.danger / totalCategorized) * 100}%` }}
                                        />
                                    )}
                                    {buckets.fading > 0 && (
                                        <span
                                            className="h-full bg-accent-bg/75"
                                            style={{ width: `${(buckets.fading / totalCategorized) * 100}%` }}
                                        />
                                    )}
                                    {buckets.stable > 0 && (
                                        <span
                                            className="h-full bg-success/80"
                                            style={{ width: `${(buckets.stable / totalCategorized) * 100}%` }}
                                        />
                                    )}
                                    {buckets.unreviewed > 0 && (
                                        <span
                                            className="h-full bg-secondary/30"
                                            style={{ width: `${(buckets.unreviewed / totalCategorized) * 100}%` }}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-metadata text-secondary tabular-nums">
                            <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-warning-text/80" />
                                {t('bucketDanger', { count: buckets.danger, defaultValue: `濒危 ${buckets.danger}` })}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-accent-bg/75" />
                                {t('bucketFading', { count: buckets.fading, defaultValue: `衰减中 ${buckets.fading}` })}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-success/80" />
                                {t('bucketStable', { count: buckets.stable, defaultValue: `稳固 ${buckets.stable}` })}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-secondary/30" />
                                {t('bucketUnreviewed', { count: buckets.unreviewed, defaultValue: `待首刷 ${buckets.unreviewed}` })}
                            </span>
                            {leechCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-warning-text font-medium">
                                    <AlertTriangle className="w-3 h-3" />
                                    {t('leechCount', { count: leechCount, defaultValue: `难词 ${leechCount}` })}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* SVG FSRS 遗忘曲线 */}
                    <div className="w-full">
                        <svg
                            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                            className="w-full h-28 overflow-visible"
                            role="img"
                            aria-label={t('forgettingCurveSvgLabel', { defaultValue: 'FSRS 30天记忆衰减曲线' })}
                        >
                            {/* 85% 推荐复习阈值虚线 */}
                            <line
                                x1={PAD_LEFT}
                                y1={thresholdY}
                                x2={CHART_WIDTH - PAD_RIGHT}
                                y2={thresholdY}
                                stroke="currentColor"
                                strokeDasharray="4 4"
                                className="text-warning-text/60"
                                strokeWidth="1"
                            />
                            <text
                                x={PAD_LEFT - 4}
                                y={thresholdY + 3}
                                textAnchor="end"
                                className="fill-current text-secondary text-[9px]"
                            >
                                85%
                            </text>

                            {/* 坐标底轴 */}
                            <line
                                x1={PAD_LEFT}
                                y1={PAD_TOP + plotH}
                                x2={CHART_WIDTH - PAD_RIGHT}
                                y2={PAD_TOP + plotH}
                                stroke="currentColor"
                                className="text-border/70"
                                strokeWidth="1"
                            />

                            {/* 衰减面积与曲线 */}
                            {areaPath && (
                                <path d={areaPath} fill="currentColor" fillOpacity="0.12" className="text-accent" />
                            )}
                            {polylinePoints && (
                                <polyline
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={polylinePoints}
                                    className="text-accent"
                                />
                            )}
                            {decayCurve.map((pt) => (
                                <circle
                                    key={pt.day}
                                    cx={toX(pt.day)}
                                    cy={toY(pt.retention)}
                                    r="2.5"
                                    fill="currentColor"
                                    className="text-accent"
                                >
                                    <title>{`${pt.day}d: ${Math.round(pt.retention * 100)}%`}</title>
                                </circle>
                            ))}

                            {/* X 轴刻度 */}
                            {[0, 7, 14, 30].map((d) => (
                                <text
                                    key={d}
                                    x={toX(d)}
                                    y={CHART_HEIGHT - 5}
                                    textAnchor="middle"
                                    className="fill-current text-secondary text-[9px]"
                                >
                                    {`${d}d`}
                                </text>
                            ))}
                        </svg>
                    </div>
                </div>
            </Card>

            {/* 右卡：未来 14 天到期负荷预测 */}
            <Card variant="default" padding={4}>
                <div className="flex flex-col gap-3 h-full justify-between">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <CalendarClock className="w-4 h-4 text-accent shrink-0" />
                            <Text type="body" weight="semibold">
                                {t('forecastTitle', { defaultValue: '未来 14 天复习负荷' })}
                            </Text>
                        </div>
                        <span className="text-metadata text-secondary tabular-nums">
                            {t('forecastTotal', {
                                count: total14DayDue,
                                defaultValue: `未来两周共 ${total14DayDue} 词`,
                            })}
                        </span>
                    </div>

                    <div
                        className="h-28 flex items-end gap-1.5 pt-3 pb-1 border-b border-border/50"
                        role="img"
                        aria-label={t('forecastChartLabel', { defaultValue: '未来14天每日到期词数柱状图' })}
                    >
                        {forecastDays.map((day) => {
                            const heightPct = day.dueCount > 0 ? Math.max(12, Math.round((day.dueCount / maxForecast) * 100)) : 4;
                            const isToday = day.dayOffset === 0;
                            const label = isToday ? t('forecastToday', { defaultValue: '今日' }) : day.dateLabel;
                            return (
                                <div
                                    key={day.dayOffset}
                                    className="flex-1 flex flex-col items-center justify-end h-full gap-1 min-w-0"
                                    title={`${label}: ${day.dueCount}`}
                                >
                                    <span className="text-[10px] leading-none text-secondary tabular-nums">
                                        {day.dueCount > 0 ? day.dueCount : ''}
                                    </span>
                                    <div className="w-full flex-1 flex items-end">
                                        <div
                                            className={cn(
                                                'w-full rounded-t-sm transition-all',
                                                day.dueCount === 0
                                                    ? 'bg-muted/60'
                                                    : isToday
                                                        ? 'bg-warning-text/80'
                                                        : 'bg-accent-bg/75',
                                            )}
                                            style={{ height: `${heightPct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between text-metadata text-secondary tabular-nums">
                        <span>{t('forecastToday', { defaultValue: '今日' })}</span>
                        <span>{forecastDays[6]?.dateLabel ?? '+6d'}</span>
                        <span>{forecastDays[13]?.dateLabel ?? '+13d'}</span>
                    </div>
                </div>
            </Card>
        </div>
    );
}
