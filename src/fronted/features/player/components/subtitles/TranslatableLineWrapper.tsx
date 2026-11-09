import { useState } from 'react';
import { cn } from '@/fronted/lib/utils';
import { FONT_SIZE } from '@/fronted/styles/style';

import type { Sentence } from '@/common/types/SentenceC';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import TranslatableLine from '@/fronted/features/player/components/translatable-line/translatable-line';

/**
 * 可交互字幕行包装组件入参。
 */
export interface TranslatableLineWrapperProps {
  sentence: Sentence;
  adjusted?: boolean;
  clearAdjust?: () => void;
  className?: string;     // 可选：容器附加 class
  coreClassName?: string; // 可选：如需给 Core 容器加类，可结合 atoms 改动一起使用
  variant?: 'default' | 'plain';
}

/**
 * 包装字幕原文行，负责悬浮显隐控制、卡片底色与尺寸适配。
 */
export default function TranslatableLineWrapper({
  sentence,
  className,
  coreClassName,
  variant = 'default'
}: TranslatableLineWrapperProps) {
  const text = sentence.text;
  const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));
  const show = usePlayerUi((state) => state.showEn);
  const [hovered, setHovered] = useState(false);

  if (!text) return <div />;

  const isHidden = !show && !hovered;

  const variantConfig = variant === 'plain'
    ? {
      root: cn(
        'relative z-10 mx-0 mt-0 rounded-none bg-transparent drop-shadow-none shadow-none text-primary pointer-events-auto transition-all duration-200 box-border',
        isHidden && 'opacity-60 hover:opacity-100'
      ),
      actions: 'absolute right-2.5 top-1.5 flex items-center gap-1.5 z-20'
    }
    : {
      root: cn(
        'relative rounded-lg drop-shadow-md mx-10 mt-2.5 shadow-inner z-50 transition-all duration-200 pointer-events-auto box-border',
        isHidden
          ? 'bg-muted/80 text-secondary border border-border/40 hover:bg-muted hover:text-primary shadow-xs'
          : 'bg-surface text-primary border border-border/80 shadow-xs'
      ),
      actions: 'absolute right-3 top-1.5 flex items-center gap-1.5 z-20'
    };

  return (
    <div
      onMouseOver={() => setHovered(true)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative flex justify-center items-center font-medium tracking-normal leading-snug',
        variantConfig.root,
        FONT_SIZE['ms1-large'],
        fontSize === 'fontSizeSmall' && FONT_SIZE['ms1-small'],
        fontSize === 'fontSizeMedium' && FONT_SIZE['ms1-medium'],
        fontSize === 'fontSizeLarge' && FONT_SIZE['ms1-large'],
        className
      )}
    >
      {/* 中间纯正文：自然居中 */}
      <div className="w-full">
        <TranslatableLine
          sentence={sentence}
          show={show || hovered}
          className={coreClassName}
        />
      </div>
    </div>
  );
}
