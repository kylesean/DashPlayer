import React, { createContext, useContext, useMemo } from 'react';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface TransLineTheme {
  container: string;              // 外层容器（TranslatableLine）
  leftIcon: string;               // 左侧时间/调整区域
  rightIcon: string;              // 右侧收藏标记区域
  core: {
    root: string;                 // TranslatableLineCore 外层（英文可点/可查）
  };
  word: {
    hoverBgClass: string;         // 单词 hover 背景（非弹层）
    vocabHighlightClass: string;  // 词汇高亮样式
    vocabFamiliarClass: string;   // 有印象但未稳定的弱提示样式
    popReferenceBgClass: string;  // 弹层 reference 的底色（非 hover）
  };
  pop: {
    openaiContainer: string;      // 单词卡弹层容器
    refreshButton: string;        // 刷新按钮样式
  };
}

const defaultTheme: TransLineTheme = {
  container: [
    'flex justify-between items-start rounded-xl mx-10 mt-2.5 z-50',
    'bg-surface text-primary border border-border shadow-xs'
  ].join(' '),
  leftIcon: 'w-10 m-2.5 h-10 flex-shrink-0',
  rightIcon: 'w-10 h-full flex items-end justify-center pb-2 flex-shrink-0',
  core: {
    root: 'px-10 pt-2.5 pb-2.5 text-center leading-relaxed box-border'
  },
  word: {
    hoverBgClass: 'transition-colors duration-150 hover:bg-muted/70 hover:shadow-xs hover:text-primary rounded px-1',
    vocabHighlightClass: 'text-accent font-medium underline decoration-accent/60 decoration-2 underline-offset-4 rounded px-0.5 transition-colors duration-150 hover:bg-accent-muted/20',
    vocabFamiliarClass: 'text-accent/80 underline decoration-dotted decoration-accent/45 decoration-1 underline-offset-4 rounded px-0.5 transition-colors duration-150 hover:bg-accent-muted/15',
    popReferenceBgClass: 'bg-accent-muted/20 shadow-xs text-accent font-medium rounded'
  },
  pop: {
    openaiContainer: 'w-[360px] h-[400px] bg-popover text-popover-foreground shadow-lg border border-border/80 rounded-xl overflow-hidden text-left relative flex flex-col',
    refreshButton: 'p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
  }
};

const ThemeCtx = createContext<TransLineTheme>(defaultTheme);

export function TransLineThemeProvider({
  value,
  children
}: {
  value?: DeepPartial<TransLineTheme>;
  children: React.ReactNode;
}) {
  const merged = useMemo(() => mergeTheme(defaultTheme, value ?? {}), [value]);
  return <ThemeCtx.Provider value={merged}>{children}</ThemeCtx.Provider>;
}

export function useTransLineTheme() {
  return useContext(ThemeCtx);
}

function mergeTheme<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const output: T = Array.isArray(base) ? [...(base as unknown[])] as T : { ...base };
  for (const k of Object.keys(patch)) {
    const v = (patch as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (isObject((base as Record<string, unknown>)[k]) && isObject(v)) {
      (output as Record<string, unknown>)[k] = mergeTheme(
        (base as Record<string, unknown>)[k],
        v as DeepPartial<unknown>
      );
    } else {
      (output as Record<string, unknown>)[k] = v;
    }
  }
  return output;
}
function isObject(o: unknown) {
  return o && typeof o === 'object' && !Array.isArray(o);
}
