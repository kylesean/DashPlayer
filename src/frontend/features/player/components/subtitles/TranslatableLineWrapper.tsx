import { useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { FONT_SIZE } from '@/frontend/styles/style';

import type { Sentence } from '@/common/types/SentenceC';
import { usePlayerUi } from '@/frontend/features/player/playerUiStore';
import useSetting from '@/frontend/features/settings/settingsStore';
import TranslatableLine from '@/frontend/features/player/components/translatable-line/translatable-line';

/**
 * 可交互字幕行包装组件入参。
 */
export interface TranslatableLineWrapperProps {
  sentence: Sentence;
  className?: string;     // 可选：容器附加 class
  coreClassName?: string; // 可选：如需给 Core 容器加类，可结合 atoms 改动一起使用
}

/**
 * 包装字幕原文行，负责悬浮显隐控制与尺寸适配。
 */
export default function TranslatableLineWrapper({
  sentence,
  className,
  coreClassName,
}: TranslatableLineWrapperProps) {
  const text = sentence.text;
  const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));
  const show = usePlayerUi((state) => state.showEn);
  const [hovered, setHovered] = useState(false);

  if (!text) return <div />;

  const isHidden = !show && !hovered;

  return (
    <div
      onMouseOver={() => setHovered(true)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative flex justify-center items-center font-medium tracking-normal leading-snug',
        'relative z-10 mx-0 mt-0 rounded-none bg-transparent drop-shadow-none shadow-none text-primary pointer-events-auto transition-all duration-200 box-border',
        isHidden && 'opacity-60 hover:opacity-100',
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
