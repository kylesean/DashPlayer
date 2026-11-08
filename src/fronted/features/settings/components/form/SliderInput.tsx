import React from 'react';
import {
    SegmentedControl,
    SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import { VStack } from '@astryxdesign/core/VStack';
import { Text } from '@astryxdesign/core/Text';

/**
 * 分段档位选择器属性定义。
 */
export interface SliderInputProps {
    /** 可选标题。 */
    title?: string;
    /** 候选档位值列表。 */
    values: string[];
    /** 当前选中的受控值。 */
    defaultValue: string;
    /** 选中新档位时的回调。 */
    setValue: (value: string) => void;
    /** 容器宽度。 */
    inputWidth?: string | number;
    /** 档位值到展示文案的映射。 */
    valueLabelMap?: Record<string, string>;
}

/**
 * 档位分段切换器：基于 Astryx SegmentedControl 实现，提供符合规范的单选切换交互。
 *
 * @param props 组件属性。
 * @returns 切换器 JSX 元素。
 */
const SliderInput: React.FC<SliderInputProps> = ({
    title,
    values,
    defaultValue,
    setValue,
    valueLabelMap,
}) => {
    return (
        <VStack gap={1}>
            {title && <Text type="label">{title}</Text>}
            <SegmentedControl
                label={title || 'Segment options'}
                value={defaultValue}
                onChange={setValue}
                size="sm"
            >
                {values.map((val) => {
                    const label = valueLabelMap?.[val] ?? val;
                    return (
                        <SegmentedControlItem
                            key={val}
                            value={val}
                            label={label}
                        />
                    );
                })}
            </SegmentedControl>
        </VStack>
    );
};

export default SliderInput;
