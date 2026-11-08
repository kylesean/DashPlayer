import { cn } from '@/fronted/lib/utils';

/** 分段档位选择器的入参。 */
export interface SliderInputProps {
    /** 可选标题。 */
    title?: string;
    /** 候选档位值列表。 */
    values: string[];
    /** 当前选中的受控值。 */
    defaultValue: string;
    /** 选中新档位时的回调。 */
    setValue: (value: string) => void;
    /** 容器宽度类名。 */
    inputWidth?: string;
    /** 档位值到展示文案的映射。 */
    valueLabelMap?: Record<string, string>;
}

/**
 * 档位切换器：直接由上层受控值驱动选中态，不在本地维护镜像状态。
 */
const SliderInput = ({
    values,
    defaultValue,
    setValue,
    inputWidth,
    valueLabelMap,
}: SliderInputProps) => {
    return (
        <div
            className={cn(
                'inline-flex items-center p-1 rounded-xl bg-muted/60 dark:bg-neutral-800/80 border border-border/60 select-none',
                inputWidth
            )}
        >
            {values.map((val, idx) => {
                const isSelected = defaultValue === val;
                const label = valueLabelMap?.[val] ?? val;

                // 视觉字号阶梯示意：A 小中大
                const fontScaleClass = idx === 0
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
                                ? 'bg-background text-foreground shadow-xs ring-1 ring-black/5 dark:ring-white/10'
                                : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                        )}
                    >
                        <span className={cn('font-serif font-bold opacity-80', fontScaleClass)}>A</span>
                        <span>{label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default SliderInput;
