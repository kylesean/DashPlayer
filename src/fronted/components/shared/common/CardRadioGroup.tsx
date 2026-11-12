import React, { createContext, useContext } from 'react';
import { cn } from '@/fronted/lib/utils';

type CardRadioGroupProps = {
    /** 组级可访问名称，由容器 role="radiogroup" 承载。 */
    label: string;
    value: string;
    onChange: (value: string) => void;
    className?: string;
    children: React.ReactNode;
};

type CardRadioContextValue = { value: string; onChange: (value: string) => void };

const CardRadioContext = createContext<CardRadioContextValue | null>(null);

/** 卡片式单选组：整组一个 Tab 停靠点，方向键 / Home / End 由卡片自己处理。 */
export function CardRadioGroup({ label, value, onChange, className, children }: CardRadioGroupProps) {
    return (
        <div role="radiogroup" aria-label={label} className={className}>
            <CardRadioContext.Provider value={{ value, onChange }}>{children}</CardRadioContext.Provider>
        </div>
    );
}

type CardRadioProps = {
    value: string;
    className?: string;
    children: React.ReactNode;
};

/** 单张可选卡片；视觉沿用原 SelectableCard 的尺寸、圆角与选中描边。 */
export function CardRadio({ value, className, children }: CardRadioProps) {
    const context = useContext(CardRadioContext);
    if (!context) throw new Error('CardRadio 必须在 CardRadioGroup 内使用');
    const checked = context.value === value;
    const select = () => {
        if (!checked) context.onChange(value);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            select();
            return;
        }
        const navigationKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
        if (!navigationKeys.includes(event.key)) return;
        const group = event.currentTarget.closest('[role="radiogroup"]');
        const radios = Array.from(group?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
        if (radios.length === 0) return;
        event.preventDefault();
        const current = radios.indexOf(event.currentTarget);
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const next = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? radios.length - 1
                : (Math.max(current, 0) + step + radios.length) % radios.length;
        const target = radios[next];
        target.focus();
        context.onChange(target.dataset.value ?? '');
    };

    return (
        <div
            role="radio"
            aria-checked={checked}
            data-value={value}
            tabIndex={checked ? 0 : -1}
            onClick={select}
            onKeyDown={handleKeyDown}
            className={cn(
                'flex items-center justify-center rounded-lg border bg-card p-2 text-primary transition-colors cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-outline-color)]',
                checked
                    ? 'border-[color:var(--color-accent)] shadow-[inset_0_0_0_2px_var(--color-accent)]'
                    : 'border-border hover:bg-muted/40',
                className,
            )}
        >
            {children}
        </div>
    );
}
