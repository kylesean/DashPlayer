import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/fronted/components/ui/tooltip';
import Md from '@/fronted/components/shared/markdown/Markdown';
import { cn } from '@/fronted/lib/utils';

interface WithMarkdownTooltipProps {
  children: React.ReactElement;
  md?: string;
  contentClassName?: string;
  asChild?: boolean;
}

export default function WithMarkdownTooltip({
  children,
  md,
  contentClassName,
  asChild = true
}: WithMarkdownTooltipProps) {
  if (!md) return children;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          className={cn(
            'max-w-sm px-3.5 py-2.5 text-xs rounded-xl border border-border/80',
            'bg-popover text-popover-foreground shadow-xl backdrop-blur-sm',
            // 覆盖 Markdown 内置 prose 样式
            '[&_.prose]:text-popover-foreground',
            '[&_.prose_p]:text-popover-foreground/90 [&_.prose_p]:m-0 [&_.prose_p]:leading-relaxed',
            '[&_.prose_h4]:text-popover-foreground [&_.prose_h4]:mb-1 [&_.prose_h4]:text-xs [&_.prose_h4]:font-semibold',
            '[&_.prose_em]:text-muted-foreground [&_.prose_em]:text-[11px] [&_.prose_em]:block [&_.prose_em]:mb-2',
            '[&_.prose_ul]:pl-3.5 [&_.prose_ul]:my-1.5 [&_.prose_li]:my-1 [&_.prose_li]:text-[11px] [&_.prose_li]:leading-normal',
            '[&_.prose_code]:text-accent [&_.prose_code]:bg-muted [&_.prose_code]:px-1.5 [&_.prose_code]:py-0.5 [&_.prose_code]:rounded [&_.prose_code]:text-[10px] [&_.prose_code]:font-mono [&_.prose_code]:before:content-none [&_.prose_code]:after:content-none',
            contentClassName
          )}
        >
          <Md>{md}</Md>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
