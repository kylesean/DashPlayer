import React from 'react';
import { cn } from '@/fronted/lib/utils';
import { HStack } from '@astryxdesign/core/HStack';
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
 * 档位分段切换器：基于 Astryx 布局原语与语义按钮实现，支持键盘交互与高可见度选中环。
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
            <HStack
                gap={1}
                padding={1}
                className="inline-flex items-center rounded-xl bg-muted/60 border border-border/60 select-none"
            >
                {values.map((val, idx) => {
                    const isSelected = defaultValue === val;
                    const label = valueLabelMap?.[val] ?? val;

                    // 视觉字号阶梯示意：A 小中大
                    const fontScaleClass =
                        idx === 0
                            ? 'text-xs'
                            : idx === 1
                            ? 'text-sm'
                            : 'text-base';

                    return (
                        <button
                            key={val}
                            type="button"
                            onClick={() => {
                                setValue(val);
                            }}
                            className={cn(
                                'flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer',
                                isSelected
                                    ? 'bg-background text-foreground shadow-xs ring-1 ring-border/60'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                            )}
                        >
                            <span className={cn('font-serif font-bold opacity-80', fontScaleClass)}>A</span>
                            <span>{label}</span>
                        </button>
                    );
                })}
            </HStack>
        </VStack>
    );
};

export default SliderInput;
