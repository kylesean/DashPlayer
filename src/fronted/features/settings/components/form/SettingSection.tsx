import React from 'react';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { StackItem } from '@astryxdesign/core/Layout';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon, type IconType } from '@astryxdesign/core/Icon';

/**
 * 设置页分组属性定义。
 */
export interface SettingSectionProps {
    /** 分组标题。 */
    title: string;
    /** 一行分组说明，超过一行的解释应下沉到具体设置项。 */
    description?: string;
    /** 标题左侧图标。 */
    icon?: IconType;
    /** 标题右侧的附加内容。 */
    action?: React.ReactNode;
    /** 分组内的设置项。 */
    children: React.ReactNode;
}

/**
 * 设置页分组：标题 + 一句话说明 + 组内设置项。
 *
 * 对应 Astryx Settings 模板的分组做法：分组本身不再套 Card，
 * 由标题层级和组间 Divider 建立结构，避免卡片套卡片。
 *
 * @param props 组件属性。
 * @returns 分组 JSX 元素。
 */
export const SettingSection: React.FC<SettingSectionProps> = ({
    title,
    description,
    icon: IconComp,
    action,
    children,
}) => (
    <VStack gap={4} width="100%">
        <VStack gap={1} width="100%">
            <HStack gap={2} vAlign="center" wrap="wrap">
                {IconComp && <Icon icon={IconComp} size="sm" color="secondary" />}
                <Heading level={3} weight="semibold">{title}</Heading>
                {action}
            </HStack>
            {description && (
                <Text type="supporting" color="secondary">
                    {description}
                </Text>
            )}
        </VStack>

        <VStack gap={4} width="100%">
            {children}
        </VStack>
    </VStack>
);

/**
 * 单条设置项属性定义。
 */
export interface SettingFieldProps {
    /** 设置项名称。 */
    title: string;
    /** 设置项说明；运行时状态提示也走这里，避免额外堆叠小字。 */
    description?: React.ReactNode;
    /** 为 true 时标题与控件顶部对齐，适合多行控件。 */
    alignTop?: boolean;
    /** 右侧控件。 */
    children?: React.ReactNode;
}

/**
 * 单条设置项：左侧名称与说明，右侧控件。
 *
 * @param props 组件属性。
 * @returns 设置项 JSX 元素。
 */
export const SettingField: React.FC<SettingFieldProps> = ({
    title,
    description,
    alignTop = false,
    children,
}) => (
    <HStack
        gap={6}
        width="100%"
        justify="between"
        vAlign={alignTop ? 'start' : 'center'}
    >
        <StackItem size="fill">
            <VStack gap={0.5}>
                <Text type="body" weight="medium">{title}</Text>
                {description && (
                    typeof description === 'string' ? (
                        <Text type="supporting" color="secondary">{description}</Text>
                    ) : (
                        description
                    )
                )}
            </VStack>
        </StackItem>
        {children && (
            <HStack gap={2} vAlign="center" justify="end">
                {children}
            </HStack>
        )}
    </HStack>
);

export default SettingSection;
