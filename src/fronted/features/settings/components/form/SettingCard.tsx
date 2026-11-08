import React, { Children } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { StackItem } from '@astryxdesign/core/Layout';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon, type IconType } from '@astryxdesign/core/Icon';

/**
 * 设置项卡片容器属性定义。
 */
export interface SettingCardProps {
    /** 卡片标题。 */
    title?: React.ReactNode;
    /** 卡片描述说明。 */
    description?: React.ReactNode;
    /** 标题左侧图标。 */
    icon?: IconType;
    /** 头部右侧操作控件。 */
    headerAction?: React.ReactNode;
    /** 卡片内部设置项行。 */
    children: React.ReactNode;
    /** 附加类名。 */
    className?: string;
}

/**
 * 单条设置行属性定义。
 */
export interface SettingRowProps {
    /** 设置项标题。 */
    title: React.ReactNode;
    /** 设置项辅助解释说明。 */
    description?: React.ReactNode;
    /** 标题左侧图标。 */
    icon?: IconType;
    /** 右侧操作控件（Switch、Selector、Button 等）。 */
    children?: React.ReactNode;
    /** 左右对齐方式：为 true 时顶部对齐，默认居中对齐。 */
    alignTop?: boolean;
    /** 附加类名。 */
    className?: string;
}

/**
 * 设置项卡片容器：统一承载一组相关的设置项。
 *
 * 遵循 Astryx 设计模式，使用 muted Card 与 subtle Divider 构建清晰的分组视野。
 *
 * @param props 组件属性。
 * @returns 卡片容器 JSX 元素。
 */
export const SettingCard: React.FC<SettingCardProps> = ({
    title,
    description,
    icon: IconComp,
    headerAction,
    children,
    className,
}) => {
    const hasHeader = Boolean(title || description || headerAction);
    const rows = Children.toArray(children);

    return (
        <VStack gap={2} width="100%" className={className}>
            {hasHeader && (
                <HStack justify="between" align="center" paddingInline={1}>
                    <VStack gap={0.5}>
                        {title && (
                            <HStack gap={2} align="center">
                                {IconComp && <Icon icon={IconComp} size="sm" color="primary" />}
                                {typeof title === 'string' ? (
                                    <Heading level={3} weight="semibold">
                                        {title}
                                    </Heading>
                                ) : (
                                    title
                                )}
                            </HStack>
                        )}
                        {description && (
                            typeof description === 'string' ? (
                                <Text type="supporting" color="secondary">
                                    {description}
                                </Text>
                            ) : (
                                description
                            )
                        )}
                    </VStack>
                    {headerAction && <HStack align="center" gap={2}>{headerAction}</HStack>}
                </HStack>
            )}

            <Card padding={0} width="100%" variant="default">
                <VStack as="ul" role="list" gap={0}>
                    {rows.map((rowItem, index) => (
                        <VStack key={index} as="li" gap={0} width="100%">
                            {index > 0 && <Divider variant="subtle" />}
                            {rowItem}
                        </VStack>
                    ))}
                </VStack>
            </Card>
        </VStack>
    );
};

/**
 * 单条设置行：左侧文案（标题+说明），右侧操作控件。
 *
 * @param props 组件属性。
 * @returns 设置行 JSX 元素。
 */
export const SettingRow: React.FC<SettingRowProps> = ({
    title,
    description,
    icon: IconComp,
    children,
    alignTop = false,
    className,
}) => {
    return (
        <VStack paddingInline={4} paddingBlock={2} gap={1} width="100%" className={className}>
            <HStack
                gap={3}
                align={alignTop ? 'start' : 'center'}
                justify="between"
                width="100%"
            >
                <StackItem size="fill">
                    <HStack gap={2} align="center">
                        {IconComp && (
                            <Icon icon={IconComp} size="sm" color="secondary" />
                        )}
                        <VStack gap={0.5}>
                            {typeof title === 'string' ? (
                                <Text type="body" weight="medium">{title}</Text>
                            ) : (
                                title
                            )}
                            {description && (
                                typeof description === 'string' ? (
                                    <Text type="supporting" color="secondary">
                                        {description}
                                    </Text>
                                ) : (
                                    description
                                )
                            )}
                        </VStack>
                    </HStack>
                </StackItem>

                {children && (
                    <HStack gap={2} align="center" justify="end">
                        {children}
                    </HStack>
                )}
            </HStack>
        </VStack>
    );
};
