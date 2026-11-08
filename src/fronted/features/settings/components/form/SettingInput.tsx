import React from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';

/**
 * 设置输入项属性定义。
 */
export interface SettingInputProps {
    /** 输入框标题/标签。 */
    title: string;
    /** 输入占位提示。 */
    placeHolder?: string;
    /** 当前受控值。 */
    value: string;
    /** 值更新回调。 */
    setValue: (value: string) => void;
    /** 输入框类型（text, password, email 等）。 */
    type?: 'text' | 'password' | 'email' | 'search' | 'tel' | 'url';
    /** 控件宽度。 */
    inputWidth?: string | number;
    /** 辅助解释描述。 */
    description?: string;
    /** 附加类名。 */
    className?: string;
    /** 失焦回调。 */
    onBlur?: () => void;
}

/**
 * 设置单项文本输入控件封装。
 *
 * 底层基于 Astryx TextInput 实现，内置无障碍标签与规范尺寸。
 *
 * @param props 组件属性。
 * @returns 输入框 JSX 元素。
 */
export const SettingInput = React.forwardRef<HTMLInputElement, SettingInputProps>(
    (
        {
            title,
            description,
            placeHolder = '',
            value,
            setValue,
            type = 'text',
            inputWidth,
            className,
            onBlur,
        },
        ref,
    ) => {
        return (
            <VStack gap={1} width="100%" className={className}>
                <TextInput
                    ref={ref}
                    label={title}
                    description={description}
                    placeholder={placeHolder}
                    value={value}
                    onChange={(val) => setValue(val)}
                    onBlur={onBlur}
                    type={type}
                    size="sm"
                    width={inputWidth || '100%'}
                />
            </VStack>
        );
    }
);

SettingInput.displayName = 'SettingInput';
export default SettingInput;
