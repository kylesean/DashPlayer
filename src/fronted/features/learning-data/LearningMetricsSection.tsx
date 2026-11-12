import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { Activity } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { InfoTip } from '@astryxdesign/core/InfoTip';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import type {
    LearningMetricKey,
    LearningMetricVO,
    LearningMetricsVO,
} from '@/common/types/learningMetrics';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';

/** 比率型指标；其余按整数展示。 */
const RATE_KEYS: readonly LearningMetricKey[] = [
    'retention7',
    'retention30',
    'reviewCompletion',
    'recommendationOpen',
    'feedbackRate',
    'practiceCoverage',
];

/** 指标值的展示文本；null 明确显示为「暂无数据」而不是 0。 */
function formatMetricValue(
    metric: LearningMetricVO,
    emptyLabel: string,
    percent: (value: number) => string,
): string {
    if (metric.value === null) {
        return emptyLabel;
    }
    return RATE_KEYS.includes(metric.key)
        ? percent(metric.value)
        : String(Math.round(metric.value));
}

/**
 * 学习指标看板。
 *
 * 北极星指标单独占一行大字，辅助指标按网格排列。每个指标都带 InfoTip
 * 说明口径——这些数字会直接影响用户对自己学习效果的判断，不能只有数字
 * 没有定义。
 */
export default function LearningMetricsSection() {
    const { t } = useTranslation('metrics');
    const { data, error, isLoading, mutate } = useSWR<LearningMetricsVO>(
        'learning-data/metrics',
        () => learningDataApi.getMetrics({ windowDays: 7 }),
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );

    const emptyLabel = t('noData');
    const percent = (value: number) => `${Math.round(value * 100)}%`;

    if (error) {
        return (
            <VStack gap={2} data-testid="learning-metrics-error">
                <Text type="supporting" color="secondary">{t('loadFailed')}</Text>
                <Button variant="secondary" size="sm" label={t('retry')} onClick={() => { void mutate(); }} />
            </VStack>
        );
    }

    if (isLoading || !data) {
        return (
            <VStack gap={3} width="100%" data-testid="learning-metrics-loading">
                <Skeleton height={72} />
                <Grid columns={{ minWidth: 160, max: 4 }} gap={3}>
                    {Array.from({ length: 6 }, (_, index) => (
                        <Skeleton key={index} height={64} />
                    ))}
                </Grid>
            </VStack>
        );
    }

    return (
        <VStack gap={4} width="100%" data-testid="learning-metrics">
            <HStack vAlign="center" gap={2}>
                <Activity className="h-4 w-4 text-accent" aria-hidden />
                <Heading level={3}>{t('title')}</Heading>
                <InfoTip content={t('windowHint', { days: data.windowDays })} label={t('title')} />
            </HStack>

            <Card>
                <VStack gap={1}>
                    <HStack vAlign="center" gap={1}>
                        <Text type="label" color="secondary">{t('northStar.label')}</Text>
                        <InfoTip content={t('northStar.hint')} label={t('northStar.label')} />
                    </HStack>
                    <Text type="display-3" data-testid="learning-metrics-north-star">
                        {formatMetricValue(data.northStar, emptyLabel, percent)}
                    </Text>
                    <Text type="supporting" color="secondary">{t('northStar.caption')}</Text>
                </VStack>
            </Card>

            <Grid columns={{ minWidth: 168, max: 4 }} gap={3}>
                {data.metrics.map((metric) => (
                    <Card key={metric.key} padding={3}>
                        <VStack gap={1}>
                            <HStack vAlign="center" gap={1}>
                                <Text type="label" color="secondary">{t(`${metric.key}.label`)}</Text>
                                <InfoTip
                                    content={t(`${metric.key}.hint`)}
                                    label={t(`${metric.key}.label`)}
                                />
                            </HStack>
                            <Text
                                type="large"
                                data-testid={`learning-metric-${metric.key}`}
                            >
                                {formatMetricValue(metric, emptyLabel, percent)}
                            </Text>
                        </VStack>
                    </Card>
                ))}
            </Grid>

            {data.unavailable.length > 0 && (
                <VStack gap={1} data-testid="learning-metrics-unavailable">
                    <Text type="supporting" color="secondary">
                        {t('unavailable.title')}
                    </Text>
                    <Text type="supporting" color="secondary">
                        {data.unavailable
                            .map((key) => t(`${key}.label`))
                            .join(' · ')}
                    </Text>
                </VStack>
            )}
        </VStack>
    );
}
