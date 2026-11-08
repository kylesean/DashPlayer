import React from 'react';
import { Switch } from '@astryxdesign/core/Switch';
import WithMarkdownTooltip from '@/fronted/components/shared/common/WithMarkdownTooltip';
import { cn } from '@/fronted/lib/utils';

interface SettingToggleProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  tooltipMd?: string;
  className?: string;
  labelClassName?: string;
}

export default function SettingToggle({
  id,
  label,
  checked,
  onCheckedChange,
  tooltipMd,
  className,
}: SettingToggleProps) {
  const row = (
    <div
      className={cn(
        'group flex items-center justify-between gap-3 rounded-xl border px-3 py-1.5 transition-all duration-150',
        'border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-border',
        checked && 'border-border/80 bg-accent/20',
        className
      )}
    >
      <Switch
        label={label}
        value={checked}
        onChange={onCheckedChange}
        size="sm"
        labelSpacing="spread"
        labelPosition="start"
        width="100%"
      />
    </div>
  );

  return tooltipMd ? (
    <WithMarkdownTooltip md={tooltipMd}>{row}</WithMarkdownTooltip>
  ) : (
    row
  );
}
