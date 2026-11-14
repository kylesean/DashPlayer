import React from 'react';
import SettingsPageShell from '@/frontend/features/settings/components/form/SettingsPageShell';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';

/**
 * 设置加载骨架屏组件属性定义。
 */
export interface SettingsLoadingSkeletonProps {
    /** 骨架屏标题。 */
    title: string;
    /** 骨架屏描述文本。 */
    description?: string;
}

/**
 * 设置子页面通用加载占位骨架屏。
 *
 * 基于 Astryx Skeleton 与 Card 实现，提供细腻的微光加载占位。
 *
 * @param props 组件属性。
 * @returns 骨架屏 JSX 元素。
 */
export const SettingsLoadingSkeleton: React.FC<SettingsLoadingSkeletonProps> = ({
    title,
    description,
}) => {
    return (
        <SettingsPageShell title={title} description={description}>
            <VStack gap={4} width="100%">
                <Card variant="transparent" padding={4} width="100%">
                    <VStack gap={4} width="100%">
                        <HStack justify="between" align="center" width="100%">
                            <VStack gap={2}>
                                <Skeleton height={16} width={140} radius={2} />
                                <Skeleton height={12} width={220} radius={2} />
                            </VStack>
                            <Skeleton height={32} width={120} radius={2} />
                        </HStack>
                        <HStack justify="between" align="center" width="100%">
                            <VStack gap={2}>
                                <Skeleton height={16} width={120} radius={2} />
                                <Skeleton height={12} width={180} radius={2} />
                            </VStack>
                            <Skeleton height={32} width={160} radius={2} />
                        </HStack>
                    </VStack>
                </Card>
            </VStack>
        </SettingsPageShell>
    );
};

export default SettingsLoadingSkeleton;
