import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Bookmark, ExternalLink, NotebookPen, Pause, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SavedSentenceTag, SavedSentenceVO } from '@/common/types/contextStudio';
import type { Sentence } from '@/common/types/SentenceC';
import TimeUtil from '@/common/utils/TimeUtil';
import useSubtitleTranslation from '@/frontend/features/player/translationStore';
import type { SentenceBlock } from '@/frontend/features/player/lib/sentence-grouping';
import { renderSentenceTokens } from '@/frontend/features/player/components/srt-layout/sentence-token-renderer';
import { highlightSlice } from '@/frontend/features/player/components/srt-layout/transcript-highlight';
import { cn } from '@/frontend/lib/utils';
import { ScriptNoteDrawer } from './ScriptNoteDrawer';

interface ScriptArticleBlockProps {
    block: SentenceBlock;
    activeSentenceIndex: number | null;
    isPlaying: boolean;
    showTranslation: boolean;
    searchQuery: string;
    popEle: string | null;
    savedKeys: ReadonlySet<string>;
    savedByKey: ReadonlyMap<string, SavedSentenceVO>;
    openNoteKey: string | null;
    onRequestPop: (key: string) => void;
    onPlaySentence: (sentence: Sentence) => void;
    onPauseAudio: () => void;
    onToggleSave: (sentence: Sentence) => void;
    onToggleNote: (sentenceKey: string) => void;
    onSaveNote: (sentence: Sentence, tag: SavedSentenceTag, note: string) => Promise<void>;
    onJumpToPlayer: (sentence: Sentence, withPractice: boolean) => void;
}

function ScriptArticleZhSpan({
    sentence,
    isCurrent,
    hasTrailingSpace,
    searchQuery,
    onPlaySentence,
}: {
    sentence: Sentence;
    isCurrent: boolean;
    hasTrailingSpace: boolean;
    searchQuery: string;
    onPlaySentence: (sentence: Sentence) => void;
}) {
    const translationKey = sentence.translationKey || '';
    const aiTranslation = useSubtitleTranslation(
        (state) => (translationKey ? state.translations.get(translationKey) : undefined),
    );
    const zhText = sentence.textZH || aiTranslation || '';
    if (!zhText) return null;

    return (
        <span
            role="button"
            tabIndex={0}
            onClick={() => onPlaySentence(sentence)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPlaySentence(sentence);
                }
            }}
            className={cn(
                'inline rounded px-1 py-0.5 cursor-pointer transition-colors',
                isCurrent ? 'text-accent font-medium bg-accent-bg/15' : 'hover:text-primary',
            )}
        >
            {highlightSlice(zhText, zhText, 0, searchQuery, false)}
            {hasTrailingSpace ? ' ' : ''}
        </span>
    );
}

/**
 * 精读文稿「讲稿模式」交互段落块：
 * 保持长文连贯排版的同时，保留逐词点击查词、单句点播高亮、收藏金句与笔记能力。
 */
export function ScriptArticleBlock({
    block,
    activeSentenceIndex,
    isPlaying,
    showTranslation,
    searchQuery,
    popEle,
    savedKeys,
    savedByKey,
    openNoteKey,
    onRequestPop,
    onPlaySentence,
    onPauseAudio,
    onToggleSave,
    onToggleNote,
    onSaveNote,
    onJumpToPlayer,
}: ScriptArticleBlockProps) {
    const { t } = useTranslation('pages');
    const activeSentenceInBlock = block.sentences.find((s) => s.index === activeSentenceIndex) ?? null;
    const noteSentenceInBlock = openNoteKey
        ? block.sentences.find((s) => `${s.fileHash}:${s.index}` === openNoteKey) ?? null
        : null;
    const focusSentence = noteSentenceInBlock ?? activeSentenceInBlock;
    const focusKey = focusSentence ? `${focusSentence.fileHash}:${focusSentence.index}` : null;
    const focusSaved = focusKey ? savedKeys.has(focusKey) : false;
    const timeStr = block.start !== undefined && block.start !== null
        ? TimeUtil.secondToTimeStrCompact(block.start)
        : '';

    return (
        <article
            className={cn(
                'max-w-3xl mx-auto rounded-lg border p-5 flex flex-col gap-3 transition-colors',
                activeSentenceInBlock
                    ? 'border-accent/45 bg-accent-bg/10'
                    : 'border-border/35 bg-surface/35',
            )}
        >
            {/* 段落时间起点与当前焦点快捷栏 */}
            <div className="flex items-center justify-between gap-2">
                {timeStr ? (
                    <button
                        type="button"
                        onClick={() => block.sentences[0] && onPlaySentence(block.sentences[0])}
                        className="text-metadata font-mono text-secondary hover:text-primary transition-colors cursor-pointer"
                        title={t('scriptReader.playBlock', { defaultValue: '从本段开始伴读' })}
                    >
                        {timeStr}
                    </button>
                ) : <span />}

                {focusSentence && focusKey && (
                    <div className="flex items-center gap-1">
                        <Tooltip
                            content={
                                isPlaying && activeSentenceIndex === focusSentence.index
                                    ? t('scriptReader.pauseAudio', { defaultValue: '暂停伴读' })
                                    : t('scriptReader.speakSentence', { defaultValue: '播放原声' })
                            }
                            placement="below"
                        >
                            <button
                                type="button"
                                onClick={() => (
                                    isPlaying && activeSentenceIndex === focusSentence.index
                                        ? onPauseAudio()
                                        : onPlaySentence(focusSentence)
                                )}
                                className="p-1 rounded-md text-secondary hover:text-primary hover:bg-muted/80 transition-colors cursor-pointer"
                                aria-label={t('scriptReader.speakSentence', { defaultValue: '播放原声' })}
                            >
                                {isPlaying && activeSentenceIndex === focusSentence.index
                                    ? <Pause className="h-3.5 w-3.5 text-accent" />
                                    : <Volume2 className="h-3.5 w-3.5" />}
                            </button>
                        </Tooltip>

                        <Tooltip content={t('scriptReader.openNotes', { defaultValue: '句法与笔记' })} placement="below">
                            <button
                                type="button"
                                onClick={() => onToggleNote(focusKey)}
                                className={cn(
                                    'p-1 rounded-md transition-colors cursor-pointer',
                                    openNoteKey === focusKey
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
                                focusSaved
                                    ? t('scriptReader.unsaveSentence', { defaultValue: '取消收藏' })
                                    : t('scriptReader.saveSentence', { defaultValue: '收藏金句' })
                            }
                            placement="below"
                        >
                            <button
                                type="button"
                                onClick={() => onToggleSave(focusSentence)}
                                className={cn(
                                    'p-1 rounded-md transition-colors cursor-pointer',
                                    focusSaved
                                        ? 'text-accent bg-accent-bg/15'
                                        : 'text-secondary hover:text-primary hover:bg-muted/80',
                                )}
                                aria-label={
                                    focusSaved
                                        ? t('scriptReader.unsaveSentence', { defaultValue: '取消收藏' })
                                        : t('scriptReader.saveSentence', { defaultValue: '收藏金句' })
                                }
                            >
                                <Bookmark className={cn('h-3.5 w-3.5', focusSaved && 'fill-current')} />
                            </button>
                        </Tooltip>

                        <Tooltip content={t('scriptReader.locateInVideoShort', { defaultValue: '定位画面' })} placement="below">
                            <button
                                type="button"
                                onClick={() => onJumpToPlayer(focusSentence, false)}
                                className="p-1 rounded-md text-secondary hover:text-primary hover:bg-muted/80 transition-colors cursor-pointer"
                                aria-label={t('scriptReader.locateInVideoShort', { defaultValue: '定位画面' })}
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>
                    </div>
                )}
            </div>

            {/* 连贯交互英文流 */}
            <div className="text-base text-primary leading-loose select-text break-words">
                {block.sentences.map((s, idx) => {
                    const isCurrent = activeSentenceIndex === s.index;
                    return (
                        <span key={`${s.fileHash}:${s.index}`}>
                            <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                    const target = e.target as HTMLElement | null;
                                    if (target?.closest('[data-word="true"]')) {
                                        return;
                                    }
                                    onPlaySentence(s);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        onPlaySentence(s);
                                    }
                                }}
                                className={cn(
                                    'inline rounded-md px-1 py-0.5 cursor-pointer transition-colors',
                                    isCurrent
                                        ? 'bg-accent-bg/20 text-primary font-medium ring-1 ring-accent/35'
                                        : 'hover:bg-muted/60',
                                )}
                            >
                                {renderSentenceTokens({
                                    sentence: s,
                                    text: s.text || '',
                                    searchQuery,
                                    isActiveMatch: false,
                                    popEle,
                                    onRequestPop,
                                    alwaysDark: false,
                                    surface: 'transcript',
                                })}
                            </span>
                            {idx < block.sentences.length - 1 ? ' ' : ''}
                        </span>
                    );
                })}
            </div>

            {/* 连贯中文译文流 */}
            {showTranslation && (
                <p className="text-sm text-secondary leading-relaxed select-text border-t border-border/30 pt-2.5 empty:hidden">
                    {block.sentences.map((s, idx) => (
                        <ScriptArticleZhSpan
                            key={`zh-${s.fileHash}:${s.index}`}
                            sentence={s}
                            isCurrent={activeSentenceIndex === s.index}
                            hasTrailingSpace={idx < block.sentences.length - 1}
                            searchQuery={searchQuery}
                            onPlaySentence={onPlaySentence}
                        />
                    ))}
                </p>
            )}

            {noteSentenceInBlock && focusKey && (
                <ScriptNoteDrawer
                    key={`${focusKey}:${savedByKey.get(focusKey)?.tag ?? ''}:${savedByKey.get(focusKey)?.note ?? ''}`}
                    sentence={noteSentenceInBlock}
                    savedRecord={savedByKey.get(focusKey)}
                    onSaveNote={onSaveNote}
                    onJumpToPlayer={onJumpToPlayer}
                />
            )}
        </article>
    );
}
