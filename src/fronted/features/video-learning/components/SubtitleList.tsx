import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClipSrtLine } from '@/common/types/clipMeta';
import { Play, Pause, CirclePause, Repeat } from 'lucide-react';
import { useVocabularyState } from '@/fronted/features/player/vocabularyStore';
import { splitWords, cleanWord } from '@/common/utils/subtitle';

type Props = {
  lines: ClipSrtLine[];
  activeIndex: number;
  playing?: boolean;
  autoPause?: boolean;
  singleRepeat?: boolean;
  onPickLine?: (idx: number) => void;
  onTogglePlay?: () => void;
  onToggleAutoPause?: () => void;
  onToggleSingleRepeat?: () => void;
};

/**
 * 渲染视频学习页的字幕列表。
 *
 * 说明：
 * - 列表中的生词高亮仅用于轻量提示，不承载主字幕的词典交互暗示。
 * - 保持英文行可扫描，但避免与主字幕的强高亮样式混淆。
 */
export default function SubtitleList({
  lines,
  activeIndex,
  playing = false,
  autoPause = false,
  singleRepeat = false,
  onPickLine,
  onTogglePlay,
  onToggleAutoPause,
  onToggleSingleRepeat
}: Props) {
  const { t } = useTranslation('player');
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const vocabularyVersion = useVocabularyState((state) => state.version);
  const isVocabularyWord = useVocabularyState((state) => state.isVocabularyWord);

  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el && containerRef.current) {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }, [activeIndex]);

  /**
   * 按 token 渲染列表里的生词轻提示。
   *
   * 说明：
   * - 采用更克制的虚线下划线与较轻字重。
   * - 不使用醒目的背景块，降低“可点击/可悬浮”的视觉预期。
   */
  const renderHighlightedText = useCallback((text: string, keyPrefix: string) => {
    if (!text) {
      return null;
    }
    const textHashBase = `${keyPrefix}-${vocabularyVersion}`;
    return splitWords(text).map((token, index) => {
      const cleaned = cleanWord(token);
      const isVocab = cleaned && isVocabularyWord(cleaned);
      if (isVocab) {
        return (
          <span
            key={`${textHashBase}-${index}`}
            className="font-medium underline decoration-dotted underline-offset-[0.18em] decoration-primary/35"
          >
            {token}
          </span>
        );
      }
      return (
        <span key={`${textHashBase}-${index}`}>
          {token}
        </span>
      );
    });
  }, [isVocabularyWord, vocabularyVersion]);

  return (
    <div ref={containerRef} className="overflow-auto max-h-64 scrollbar-thin pr-1">
      <div className="space-y-1.5">
        {lines.map((line, idx) => (
          <div
            key={idx}
            ref={(r) => {
              itemRefs.current[idx] = r;
            }}
            className={`p-2.5 rounded-lg text-sm transition-all ${
              idx === activeIndex
                ? 'bg-accent-bg/10 border border-accent-bg/20 text-foreground shadow-2xs font-medium'
                : line.isClip
                  ? 'bg-muted/40 hover:bg-muted/70 text-foreground'
                  : 'hover:bg-muted/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            <div className="flex items-start justify-between">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onPickLine?.(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPickLine?.(idx);
                  }
                }}
                className="flex-1 min-w-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <div className="text-sm leading-relaxed text-foreground">
                  {renderHighlightedText(line.contentEn, `${idx}-${line.index}`)}
                </div>
                {line.contentZh && (
                  <div className="text-metadata text-muted-foreground mt-1 leading-normal">{line.contentZh}</div>
                )}
              </div>

              {/* 当前行的状态图标 */}
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                {idx === activeIndex ? (
                  <>
                    {/* 播放/暂停按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePlay?.();
                      }}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      aria-label={playing ? t('subtitleList.pause') : t('subtitleList.play')}
                      title={playing ? t('subtitleList.pause') : t('subtitleList.play')}
                    >
                      {playing ? (
                        <Pause className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <Play className="w-3 h-3 text-muted-foreground" />
                      )}
                    </button>

                    {/* 自动暂停状态 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleAutoPause?.();
                      }}
                      className={`p-1 rounded transition-colors ${
                        autoPause
                          ? 'bg-accent-bg/10'
                          : 'hover:bg-muted'
                      }`}
                      aria-pressed={autoPause}
                      aria-label={autoPause ? t('subtitleList.autoPauseOn') : t('subtitleList.autoPauseOff')}
                      title={autoPause ? t('subtitleList.autoPauseOn') : t('subtitleList.autoPauseOff')}
                    >
                      <CirclePause className={`w-3 h-3 ${
                        autoPause
                          ? 'text-accent'
                          : 'text-muted-foreground'
                      }`} />
                    </button>

                    {/* 单句循环状态 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSingleRepeat?.();
                      }}
                      className={`p-1 rounded transition-colors ${
                        singleRepeat
                          ? 'bg-success-muted'
                          : 'hover:bg-muted'
                      }`}
                      aria-pressed={singleRepeat}
                      aria-label={singleRepeat ? t('subtitleList.singleRepeatOn') : t('subtitleList.singleRepeatOff')}
                      title={singleRepeat ? t('subtitleList.singleRepeatOn') : t('subtitleList.singleRepeatOff')}
                    >
                      <Repeat className={`w-3 h-3 ${
                        singleRepeat
                          ? 'text-success-text'
                          : 'text-muted-foreground'
                      }`} />
                    </button>
                  </>
                ) : (
                  // 非当前行：纯占位，保持布局稳定；用不可聚焦的 span，避免进入 Tab 顺序
                  <div className="flex items-center gap-1 opacity-0" aria-hidden="true">
                    <span className="p-1 w-6 h-6 inline-flex items-center justify-center">
                      <Play className="w-3 h-3" />
                    </span>
                    <span className="p-1 w-6 h-6 inline-flex items-center justify-center">
                      <CirclePause className="w-3 h-3" />
                    </span>
                    <span className="p-1 w-6 h-6 inline-flex items-center justify-center">
                      <Repeat className="w-3 h-3" />
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
