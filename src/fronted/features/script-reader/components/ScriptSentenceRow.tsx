import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Bookmark, ExternalLink, NotebookPen, Pause, Play, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SceneBoundary } from '@/common/learning/sceneSegmentation';
import type { SavedSentenceTag, SavedSentenceVO } from '@/common/types/contextStudio';
import type { Sentence } from '@/common/types/SentenceC';
import TimeUtil from '@/common/utils/TimeUtil';
import useSubtitleTranslation from '@/fronted/features/player/translationStore';
import { renderSentenceTokens } from '@/fronted/features/player/components/srt-layout/sentence-token-renderer';
import { highlightSlice } from '@/fronted/features/player/components/srt-layout/transcript-highlight';
import { cn } from '@/fronted/lib/utils';
import { ScriptNoteDrawer } from './ScriptNoteDrawer';

interface ScriptSentenceRowProps {
    sentence: Sentence;
    isActive: boolean;
    isPlaying: boolean;
    isSaved: boolean;
    savedRecord?: SavedSentenceVO;
    isNoteOpen: boolean;
    showTranslation: boolean;
    searchQuery: string;
    popEle: string | null;
    sceneDivider?: SceneBoundary;
    onRequestPop: (key: string) => void;
    onPlaySentence: (sentence: Sentence) => void;
    onPauseAudio: () => void;
    onToggleSave: (sentence: Sentence) => void;
    onToggleNote: (sentenceKey: string) => void;
    onSaveNote: (sentence: Sentence, tag: SavedSentenceTag, note: string) => Promise<void>;
    onJumpToPlayer: (sentence: Sentence, withPractice: boolean) => void;
}

/**
 * 精读文稿单句行（P0-P2）：
 * - 复用 renderSentenceTokens 提供点击查词、发音与生词标识；
 * - 集成高置信度场景分割线（支持点击跳转起播）；
 * - 支持内联展开笔记与句法理解抽屉、收藏金句及定位到播放器。
 */
export function ScriptSentenceRow({
    sentence,
    isActive,
    isPlaying,
    isSaved,
    savedRecord,
    isNoteOpen,
    showTranslation,
    searchQuery,
    popEle,
    sceneDivider,
    onRequestPop,
    onPlaySentence,
    onPauseAudio,
    onToggleSave,
    onToggleNote,
    onSaveNote,
    onJumpToPlayer,
}: ScriptSentenceRowProps) {
    const { t } = useTranslation('pages');
    const key = `${sentence.fileHash}:${sentence.index}`;
    const startSec = sentence.adjustedStart ?? sentence.start;
    const hasNote = Boolean(savedRecord?.note?.trim());
    const activePlayingHere = isActive && isPlaying;
    const translationKey = sentence.translationKey || '';
    const aiTranslation = useSubtitleTranslation(
        (state) => (showTranslation && translationKey ? state.translations.get(translationKey) : undefined),
    );
    const zhText = sentence.textZH || aiTranslation || '';

    return (
        <div className="max-w-3xl mx-auto">
            {sceneDivider && (
                <div
                    data-testid="script-scene-divider"
                    className="my-3 flex items-center gap-2"
                >
                    <div className="h-px flex-1 bg-border/50" />
                    <button
                        type="button"
                        onClick={() => onPlaySentence(sentence)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-metadata font-medium text-secondary hover:bg-muted/70 hover:text-primary transition-colors cursor-pointer"
                    >
                        <Play className="h-3.5 w-3.5 shrink-0" />
                        <span>
                            {sceneDivider.kinds.includes('topic-shift')
                                ? t('scriptReader.sceneTopicLabel', { defaultValue: '新话题' })
                                : t('scriptReader.sceneNewLabel', { defaultValue: '新场景' })}
                            {' · '}
                            {TimeUtil.secondToTimeStrCompact(startSec)}
                        </span>
                    </button>
                    <div className="h-px flex-1 bg-border/50" />
                </div>
            )}

            <div
                data-testid={`script-sentence-row-${sentence.index}`}
                data-active={isActive ? 'true' : 'false'}
                className={cn(
                    'group rounded-lg border px-4 py-3 transition-colors',
                    isActive
                        ? 'border-accent/50 bg-accent-bg/10'
                        : 'border-border/35 bg-surface/40 hover:border-border/70',
                )}
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => (activePlayingHere ? onPauseAudio() : onPlaySentence(sentence))}
                                className={cn(
                                    'text-metadata font-mono transition-colors cursor-pointer rounded px-1 -ml-1',
                                    isActive
                                        ? 'text-accent font-medium'
                                        : 'text-secondary hover:text-primary hover:bg-muted/60',
                                )}
                                title={t('scriptReader.playFromHere', { defaultValue: '从这一句开始伴读' })}
                            >
                                {TimeUtil.secondToTimeStrCompact(startSec)}
                            </button>
                            {hasNote && !isNoteOpen && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-metadata text-secondary">
                                    {t('scriptReader.hasNoteBadge', { defaultValue: '已记笔记' })}
                                </span>
                            )}
                        </div>

                        <p className="text-base text-primary leading-relaxed select-text break-words">
                            {renderSentenceTokens({
                                sentence,
                                text: sentence.text || '',
                                searchQuery,
                                isActiveMatch: false,
                                popEle,
                                onRequestPop,
                                alwaysDark: false,
                                surface: 'transcript',
                            })}
                        </p>

                        {showTranslation && zhText && (
                            <p className="text-sm text-secondary leading-relaxed select-text break-words">
                                {highlightSlice(zhText, zhText, 0, searchQuery, false)}
                            </p>
                        )}
                    </div>

                    <div
                        className={cn(
                            'flex items-center gap-1 shrink-0 transition-opacity',
                            (isSaved || hasNote || isNoteOpen || activePlayingHere)
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                        )}
                    >
                        <Tooltip
                            content={
                                activePlayingHere
                                    ? t('scriptReader.pauseAudio', { defaultValue: '暂停伴读' })
                                    : t('scriptReader.speakSentence', { defaultValue: '播放原声' })
                            }
                            placement="below"
                        >
                            <button
                                type="button"
                                onClick={() => (activePlayingHere ? onPauseAudio() : onPlaySentence(sentence))}
                                className={cn(
                                    'p-1.5 rounded-md transition-colors cursor-pointer',
                                    activePlayingHere
                                        ? 'text-accent bg-accent-bg/15'
                                        : 'text-secondary hover:text-primary hover:bg-muted/80',
                                )}
                                aria-label={
                                    activePlayingHere
                                        ? t('scriptReader.pauseAudio', { defaultValue: '暂停伴读' })
                                        : t('scriptReader.speakSentence', { defaultValue: '播放原声' })
                                }
                            >
                                {activePlayingHere
                                    ? <Pause className="h-3.5 w-3.5" />
                                    : <Volume2 className="h-3.5 w-3.5" />}
                            </button>
                        </Tooltip>

                        <Tooltip content={t('scriptReader.openNotes', { defaultValue: '句法与笔记' })} placement="below">
                            <button
                                type="button"
                                onClick={() => onToggleNote(key)}
                                className={cn(
                                    'p-1.5 rounded-md transition-colors cursor-pointer',
                                    (isNoteOpen || hasNote)
                                        ? 'text-accent bg-accent-bg/15'
                                        : 'text-secondary hover:text-primary hover:bg-muted/80',
                                )}
                                aria-label={t('scriptReader.openNotes', { defaultValue: '句法与笔记' })}
                            >
                                <NotebookPen className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>

                        <Tooltip
                            content={
                                isSaved
                                    ? t('scriptReader.unsaveSentence', { defaultValue: '取消收藏' })
                                    : t('scriptReader.saveSentence', { defaultValue: '收藏金句' })
                            }
                            placement="below"
                        >
                            <button
                                type="button"
                                onClick={() => onToggleSave(sentence)}
                                className={cn(
                                    'p-1.5 rounded-md transition-colors cursor-pointer',
                                    isSaved
                                        ? 'text-accent bg-accent-bg/15'
                                        : 'text-secondary hover:text-primary hover:bg-muted/80',
                                )}
                                aria-label={
                                    isSaved
                                        ? t('scriptReader.unsaveSentence', { defaultValue: '取消收藏' })
                                        : t('scriptReader.saveSentence', { defaultValue: '收藏金句' })
                                }
                            >
                                <Bookmark className={cn('h-3.5 w-3.5', isSaved && 'fill-current')} />
                            </button>
                        </Tooltip>

                        <Tooltip content={t('scriptReader.locateInVideoShort', { defaultValue: '定位画面' })} placement="below">
                            <button
                                type="button"
                                onClick={() => onJumpToPlayer(sentence, false)}
                                className="p-1.5 rounded-md text-secondary hover:text-primary hover:bg-muted/80 transition-colors cursor-pointer"
                                aria-label={t('scriptReader.locateInVideoShort', { defaultValue: '定位画面' })}
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>
                    </div>
                </div>

                {isNoteOpen && (
                    <ScriptNoteDrawer
                        key={`${key}:${savedRecord?.tag ?? ''}:${savedRecord?.note ?? ''}`}
                        sentence={sentence}
                        savedRecord={savedRecord}
                        onSaveNote={onSaveNote}
                        onJumpToPlayer={onJumpToPlayer}
                    />
                )}
            </div>
        </div>
    );
}
