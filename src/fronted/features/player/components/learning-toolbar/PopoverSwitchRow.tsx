import { Switch } from '@astryxdesign/core/Switch';

/**
 * 弹层内即时生效开关行属性。
 */
export interface PopoverSwitchRowProps {
    label: string;
    description?: string;
    labelTooltip?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    isDisabled?: boolean;
    disabledMessage?: string;
    testId?: string;
}

/**
 * 弹层内即时生效的快捷开关行。
 *
 * 遵循 Astryx 规范：
 * - labelPosition="start" 与 labelSpacing="spread" 保持统一左文右开对齐；
 * - 详细提示收敛至 labelTooltip（ⓘ 悬停展示），保持面板紧凑无滚动。
 */
export function PopoverSwitchRow({
    label,
    description,
    labelTooltip,
    checked,
    onChange,
    isDisabled,
    disabledMessage,
    testId,
}: PopoverSwitchRowProps) {
    return (
        <div className="rounded-lg px-2 py-1 transition-colors hover:bg-muted/40">
            <Switch
                label={label}
                description={description}
                labelTooltip={labelTooltip}
                labelPosition="start"
                labelSpacing="spread"
                size="sm"
                width="100%"
                value={checked}
                onChange={onChange}
                isDisabled={isDisabled}
                disabledMessage={disabledMessage}
                data-testid={testId}
            />
        </div>
    );
}
