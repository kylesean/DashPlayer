import React from 'react';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Icon, type IconType } from '@astryxdesign/core/Icon';

/**
 * 分组卡片内的子区块标题行属性定义。
 */
export interface SettingBlockHeaderProps {
    /** 标题内容。 */
    title: React.ReactNode;
    /** 辅助解释描述。 */
    description?: React.ReactNode;
    /** 标题图标。 */
    icon?: IconType;
    /** 右侧动作区，如"打开文件夹"按钮。 */
    action?: React.ReactNode;
}

/**
 * 分组卡片内的子区块标题行：左侧标题 + 说明，右侧动作。
 *
 * @param props 组件属性。
 * @returns 标题行 JSX 元素。
 */
export const SettingBlockHeader: React.FC<SettingBlockHeaderProps> = ({
    title,
    description,
    icon: IconComp,
    action,
}) => (
    <HStack justify="between" align="center" wrap="wrap" gap={2} width="100%">
        <VStack gap={0.5}>
            <HStack gap={2} align="center">
                {IconComp && <Icon icon={IconComp} size="sm" color="secondary" />}
                {typeof title === 'string' ? (
                    <Text type="label">{title}</Text>
                ) : (
                    title
                )}
            </HStack>
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
        {action && <HStack align="center" gap={2}>{action}</HStack>}
    </HStack>
);

export default SettingBlockHeader;
