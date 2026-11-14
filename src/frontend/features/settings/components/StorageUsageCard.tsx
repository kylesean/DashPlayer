import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, HardDriveDownload } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import StorageUsageDonutChart from './StorageUsageDonutChart';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { Token } from '@astryxdesign/core/Token';
import type {
    StorageUsageCategory,
    StorageUsageVO,
} from '@/common/contracts/storage-usage-vo';

const CATEGORY_TOKEN_COLOR: Record<StorageUsageCategory, 'blue' | 'orange' | 'green' | 'purple' | 'gray' | 'pink'> = {
    videos: 'blue',
    favorite_clips: 'orange',
    word_clips: 'green',
    models: 'purple',
    temp: 'gray',
    other: 'pink',
};

const CATEGORY_ORDER: StorageUsageCategory[] = [
    'videos',
    'word_clips',
    'models',
    'temp',
    'favorite_clips',
    'other',
];

/**
 * 将字节数格式化为带单位的可读大小。
 *
 * @param bytes 文件大小，单位字节。
 * @returns 带单位的文件大小。
 */
function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return unitIndex === 0
        ? `${size} ${units[unitIndex]}`
        : `${size.toFixed(2)} ${units[unitIndex]}`;
}

/** 存储用量卡片属性定义。 */
export interface StorageUsageCardProps {
    /** 用量明细；null 表示尚未加载完成或存储目录不可用。 */
    usage: StorageUsageVO | null;
    /** 是否正在加载用量明细。 */
    loading: boolean;
    /** 手动触发一次用量刷新。 */
    onRefresh: () => void;
}

/**
 * 存储用量卡片的加载骨架屏。
 *
 * 保持与加载后完全一致的尺寸和布局（环形图 + 6行明细），避免布局跳变。
 */
const StorageUsageSkeleton: React.FC = () => {
    return (
        <VStack data-testid="storage-usage-skeleton" width="100%">
            <HStack gap={6} padding={4} align="center" wrap="wrap" width="100%">
                <VStack align="center" justify="center" width={176} height={176}>
                    <Skeleton width={160} height={160} radius="rounded" />
                </VStack>

                <VStack gap={2} width="100%">
                    {CATEGORY_ORDER.map((key) => (
                        <HStack key={key} gap={3} align="center" padding={1} width="100%">
                            <Skeleton width={12} height={12} radius={1} />
                            <Skeleton width={96} height={14} radius={2} />
                            <Skeleton width={80} height={14} radius={2} />
                            <Skeleton width={48} height={14} radius={2} />
                        </HStack>
                    ))}
                </VStack>
            </HStack>
        </VStack>
    );
};

/**
 * 存储用量卡片：以环形图加明细列表展示媒体库各分类的占用大小。
 *
 * @param props 组件属性。
 * @returns 用量卡片 JSX 元素。
 */
const StorageUsageCard: React.FC<StorageUsageCardProps> = ({
    usage,
    loading,
    onRefresh,
}) => {
    const { t } = useTranslation('settings');

    const chartSegments = React.useMemo(
        () =>
            (usage?.items ?? []).map((item) => ({
                category: item.category,
                bytes: item.bytes,
            })),
        [usage],
    );

    const labelForCategory = React.useCallback(
        (category: StorageUsageCategory) => t(`storage.usage.categories.${category}`),
        [t],
    );

    const totalBytes = usage?.totalBytes ?? 0;
    const showSkeleton = loading && !usage;
    const emptyOrUnavailableMessage =
        !loading && usage === null
            ? t('storage.usage.unavailable')
            : !loading && totalBytes === 0
            ? t('storage.usage.empty')
            : null;

    return (
        <VStack gap={4} width="100%">
            <HStack justify="between" vAlign="center" width="100%">
                <HStack vAlign="center" gap={1.5}>
                    <Text type="supporting" color="secondary">
                        {t('storage.usage.totalLabel')}
                    </Text>
                    {showSkeleton ? (
                        <Skeleton width={64} height={20} radius={2} />
                    ) : (
                        <Text type="label" weight="semibold" hasTabularNumbers>
                            {usage ? formatBytes(totalBytes) : '--'}
                        </Text>
                    )}
                </HStack>
                <IconButton
                    label={t('storage.refreshUsage')}
                    tooltip={t('storage.refreshUsage')}
                    icon={<Icon icon={RefreshCw} size="sm" />}
                    variant="secondary"
                    size="sm"
                    isLoading={loading}
                    onClick={onRefresh}
                />
            </HStack>
            {showSkeleton ? (
                <StorageUsageSkeleton />
            ) : emptyOrUnavailableMessage ? (
                <VStack align="center" justify="center" gap={2} padding={6} width="100%">
                    <Icon icon={HardDriveDownload} size="lg" color="secondary" />
                    <Text type="supporting" color="secondary">
                        {emptyOrUnavailableMessage}
                    </Text>
                </VStack>
            ) : (
                <HStack gap={6} padding={4} align="center" wrap="wrap" width="100%">
                    <StorageUsageDonutChart
                        segments={chartSegments}
                        totalBytes={totalBytes}
                        formatBytes={formatBytes}
                        labelFor={labelForCategory}
                        className="mx-auto aspect-square h-44 w-44 shrink-0"
                    />

                    <VStack gap={2} width="100%">
                        {(usage?.items ?? []).map((item) => {
                            const ratio = totalBytes > 0 ? item.bytes / totalBytes : 0;
                            const percentage = (ratio * 100).toFixed(1);

                            return (
                                <HStack
                                    key={item.category}
                                    gap={3}
                                    align="center"
                                    padding={1}
                                    justify="between"
                                    width="100%"
                                >
                                    <HStack gap={2} align="center">
                                        <Token
                                            size="sm"
                                            color={CATEGORY_TOKEN_COLOR[item.category]}
                                            label={t(`storage.usage.categories.${item.category}`)}
                                        />
                                    </HStack>

                                    <HStack gap={3} align="center">
                                        <Text type="body" weight="medium" hasTabularNumbers>
                                            {formatBytes(item.bytes)}
                                        </Text>
                                        <Text type="supporting" color="secondary" hasTabularNumbers>
                                            {percentage}%
                                        </Text>
                                    </HStack>
                                </HStack>
                            );
                        })}
                    </VStack>
                </HStack>
            )}
        </VStack>
    );
};

export default StorageUsageCard;
