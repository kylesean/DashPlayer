import type { ComponentProps } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '@/frontend/lib/utils';

/**
 * 可拖拽分栏容器：横向与纵向都撑满父级，纵向时自动切换为列布局。
 *
 * 只保留布局必需的能力，具体比例、最小尺寸与持久化由调用方决定。
 */
const SplitLayout = ({ className, ...props }: ComponentProps<typeof PanelGroup>) => (
    <PanelGroup
        className={cn(
            'flex h-full w-full data-[panel-group-direction=vertical]:flex-col',
            className,
        )}
        {...props}
    />
);

/** 分栏中的单个面板。 */
const SplitPane = Panel;

/**
 * 分栏拖拽把手。
 *
 * 默认画一条 1px 分隔线，并把可点击热区向两侧扩展到 4px；
 * 颜色、悬停态与内部装饰由调用方通过 className 与 children 覆盖。
 */
const SplitHandle = ({ className, ...props }: ComponentProps<typeof PanelResizeHandle>) => (
    <PanelResizeHandle
        className={cn(
            'relative flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:ring-offset-1',
            'w-px bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
            'data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0',
            className,
        )}
        {...props}
    />
);

export { SplitLayout, SplitPane, SplitHandle };
