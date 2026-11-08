import React from 'react';
import { VStack, HStack } from '@astryxdesign/core/VStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Divider } from '@astryxdesign/core/Divider';

/**
 * 设置子页面容器属性定义。
 */
export interface SettingsPageShellProps {
    /** 页面主标题。 */
    title: string;
    /** 页面辅助描述说明。 */
    description?: React.ReactNode;
    /** 页面设置表单主体内容。 */
    children: React.ReactNode;
    /** 底部动作区（如保存、重置按钮等）。 */
    actions?: React.ReactNode;
    /** 外部自定义类名。 */
    className?: string;
    /** 内容区域自定义类名。 */
    contentClassName?: string;
}

/**
 * 设置子页面统一骨架外壳组件。
 *
 * 采用 Astryx 布局原语构建，统一负责设置页面的标题排版、分割线以及滚动区域。
 *
 * @param props 组件属性。
 * @returns 页面外壳 JSX 元素。
 */
const SettingsPageShell: React.FC<SettingsPageShellProps> = ({
    title,
    description,
    children,
    actions,
    className,
    contentClassName,
}) => {
    return (
        <VStack gap={4} width="100%" height="fill" className={className}>
            <VStack gap={1}>
                <Heading level={2}>{title}</Heading>
                {description ? (
                    typeof description === 'string' ? (
                        <Text type="supporting" color="secondary">
                            {description}
                        </Text>
                    ) : (
                        description
                    )
                ) : null}
            </VStack>

            <Divider variant="subtle" />

            <VStack
                gap={5}
                width="100%"
                isScrollable
                className={contentClassName}
            >
                {children}
                {actions ? (
                    <HStack justify="end" gap={2} paddingBlockStart={4}>
                        {actions}
                    </HStack>
                ) : null}
            </VStack>
        </VStack>
    );
};

export default SettingsPageShell;
