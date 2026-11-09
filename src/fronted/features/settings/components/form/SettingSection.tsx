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
            <HStack gap={2} vAlign="center" width="100%">
                {IconComp && <Icon icon={IconComp} size="sm" color="secondary" />}
                <Heading level={3} weight="semibold">{title}</Heading>
                {action && (
                    <>
                        <StackItem size="fill" />
                        <HStack gap={2} vAlign="center">{action}</HStack>
                    </>
                )}
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
    /**
     * 供自动化用例定位本行的稳定标识。
     *
     * 为什么需要：用例此前只能靠「行内文案 + `div` 里最后一个 combobox」来定位，
     * 一旦页面布局或同文案控件数量变化就会串台或失配（实测把设置行拆成
     * 两层容器后，`.last()` 直接指到了相邻行）。文案是给人看的、会改；
     * 这个标识只给机器用，且不随排版变化。
     *
     * 不传则不渲染 `data-testid`，因此不影响任何现有页面。
     */
    testId?: string;
    /** 右侧控件。 */
    children?: React.ReactNode;
}

/**
 * 单条设置项：左侧名称与说明，右侧控件。
 *
 * 响应式：窄容器下改为纵向堆叠（文案在上、控件在下）。
 *
 * 为什么必须这么做：右侧控件是固定宽度（服务与资源页的 Selector 都是 224px），
 * 而设置内容区在窄窗口里可能只剩一百多像素。横排时左侧文案会被压到 **0 宽**——
 * 文字仍在 DOM 与可访问树里，但用户一个字都看不见（实测 461px 窗口下
 * 说明文字宽度为 0px，自动化用例只拿到「存在但不可见」）。
 * 堆叠后宽度不再被右侧控件抢走，文案始终可读。
 *
 * 用容器查询（`@container`）而不是视口断点：设置页同时出现在整窗与侧栏分栏里，
 * 决定排版的应该是「这一行有多宽」，而不是窗口有多宽。
 *
 * @param props 组件属性。
 * @returns 设置项 JSX 元素。
 */
export const SettingField: React.FC<SettingFieldProps> = ({
    title,
    description,
    alignTop = false,
    testId,
    children,
}) => (
    <div className="@container w-full">
        <HStack
            gap={6}
            width="100%"
            justify="between"
            vAlign={alignTop ? 'start' : 'center'}
            data-testid={testId}
            className="flex-col items-stretch gap-2 @[26rem]:flex-row @[26rem]:items-center @[26rem]:gap-6"
        >
            <StackItem size="fill" className="min-w-0">
                <VStack gap={0.5} className="min-w-0">
                    <Text type="body" weight="medium">{title}</Text>
                    {description && (
                        typeof description === 'string' ? (
                            <Text type="supporting" color="secondary" className="break-words">{description}</Text>
                        ) : (
                            description
                        )
                    )}
                </VStack>
            </StackItem>
            {children && (
                <HStack gap={2} vAlign="center" justify="end" className="shrink-0">
                    {children}
                </HStack>
            )}
        </HStack>
    </div>
);

export default SettingSection;
