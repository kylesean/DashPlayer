import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/fronted/lib/utils';

/**
 * 视频控制条二级弹窗的统一外观。
 *
 * 倍速、训练模式、字幕轨道三处弹窗共用这里的取值：面板、行、分组标题、分隔线、提示文字。
 * 调用方只负责拼宽度与内容，不再各自写一套样式；新增弹窗也必须从这里取，
 * 否则同一控制条上又会分叉出第二种观感。
 */

/**
 * 弹窗面板：深色玻璃底，与视频控制条同族；宽度由调用方按内容拼。
 *
 * 在紧凑弹层作用域内覆盖 --text-label-size 为 supporting-size，使内部所有 Astryx
 * Switch / FieldLabel 与 Button size="sm"、SegmentedControl size="sm"、自定义列表项保持完全一致的字号。
 *
 * 开启保留 150ms 淡入；关闭由原生 popover 即时移除，不会出现「旧菜单渐隐 + 新菜单渐显」同屏。
 */
export const CONTROL_POPOVER_PANEL =
    'p-2 outline-none bg-surface/95 backdrop-blur-xl border border-border text-primary shadow-2xl rounded-2xl [--text-label-size:var(--text-supporting-size)] [--text-label-leading:var(--text-supporting-leading)] animate-in fade-in-0 zoom-in-95 duration-150';

/** 弹窗内的分组标题。 */
export const CONTROL_POPOVER_LABEL = 'px-2 py-1.5 text-sm font-semibold text-secondary';

/** 弹窗内的分隔线：拉通到面板边缘。 */
export const CONTROL_POPOVER_SEPARATOR = '-mx-2 my-1 h-px bg-border/60';

/**
 * 弹窗底边到触发按钮顶边的间距（Astryx usePopover 的 offset）。
 *
 * 控制条上的弹窗一律向上生长，必须让开宿主控制条自己上方的内容，否则会压住本条的进度条。
 * 按宿主形状取值，不要用一个数字凑两种控制条：
 * - 分层控制条（进度条一行 + 按钮一行）：按钮行上沿距面板上沿约 41px，弹窗正好落在面板之上；
 * - 单行控制条（进度条与按钮同一行）：该距离约 17px。
 */
export const CONTROL_POPOVER_OFFSET_STACKED_BAR = 44;
export const CONTROL_POPOVER_OFFSET_SINGLE_ROW_BAR = 20;

/** 行右侧的次要信息（快捷键、参数摘要）：短、等宽、压暗，过长时截断（全文挂 title）。 */
export const CONTROL_POPOVER_HINT = 'min-w-0 truncate text-metadata font-mono text-secondary';

/** 行内图标：不设颜色，跟随本行文字颜色。 */
export const CONTROL_POPOVER_ICON = 'w-3.5 h-3.5 shrink-0';

/** 弹层内一行的基础形状；需要自定义内容的行（如打开二级弹层）复用它，保持行高与内边距一致。 */
export const CONTROL_POPOVER_ROW_BASE =
    'flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer select-none transition-colors outline-none';
const ROW_EMPHASIZED = 'bg-primary/20 text-primary font-medium';
/** 普通行的未激活配色（深色弹层上）。 */
export const CONTROL_POPOVER_ROW_IDLE =
    'text-secondary hover:bg-muted/60 hover:text-primary focus-visible:bg-muted focus-visible:text-primary';

export interface ControlPopoverRowProps {
    /** 勾选态：左侧勾选槽里出现勾；复选列表只用这个，不要再加整行底色 */
    checked?: boolean;
    /** 整行高亮：只给单选列表的当前项用（如倍速档位）。复选列表里多行同时亮会连成一块色 */
    emphasize?: boolean;
    /** 勾选槽之后的图标，尺寸用 CONTROL_POPOVER_ICON */
    icon?: ReactNode;
    label: ReactNode;
    /** 行右侧：提示文字或自定义控件；自定义控件若需拦截点击请自行包一层 */
    right?: ReactNode;
    /** 悬停原生长提示：单行放不下的补充说明放这里，别撑高行 */
    title?: string;
    /** 点击或键盘回车/空格触发 */
    onActivate: () => void;
    className?: string;
}

/**
 * 弹窗内的一行：左侧「勾选槽 + 图标 + 标题」，右侧提示文字或自定义控件。
 *
 * 勾选槽恒定占位（非勾选行留空槽），故同一弹窗内各行的标题左边界对齐、行高一致；
 * 放不下的补充说明走 title，不要另起一行。
 *
 * @returns 弹窗内的一行。
 */
export function ControlPopoverRow({
    checked,
    emphasize,
    icon,
    label,
    right,
    title,
    onActivate,
    className,
}: ControlPopoverRowProps) {
    return (
        <div
            className={cn(
                CONTROL_POPOVER_ROW_BASE,
                emphasize ? ROW_EMPHASIZED : CONTROL_POPOVER_ROW_IDLE,
                emphasize
                    ? 'has-[:focus-visible]:text-primary'
                    : 'has-[:focus-visible]:bg-muted has-[:focus-visible]:text-primary',
                className,
            )}
        >
            {/* 行点击语义放在原生 button 上；right 作为兄弟节点渲染，
                避免可点击控件嵌套在可点击容器内导致 Enter/Space 双动作。 */}
            <button
                type="button"
                aria-pressed={checked}
                title={title}
                onClick={onActivate}
                className="flex flex-1 items-center gap-2 min-w-0 bg-transparent text-left outline-none rounded-md"
            >
                <span className="w-3.5 shrink-0 flex items-center justify-center">
                    {checked && <Check className="w-3.5 h-3.5 text-primary stroke-[2.5]" />}
                </span>
                {icon}
                <span className="truncate">{label}</span>
            </button>
            {right}
        </div>
    );
}
