import { Button } from '@astryxdesign/core/Button';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { BookMarked, Compass, ExternalLink, Languages, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SceneBoundary } from '@/common/learning/sceneSegmentation';
import TimeUtil from '@/common/utils/TimeUtil';
import { cn } from '@/frontend/lib/utils';
import type { ScriptReaderFilter, ScriptVocabPreviewItem } from '../lib/readerProgress';

export type ReaderViewMode = 'sentence' | 'article';

interface ScriptReaderToolbarProps {
    title: string;
    totalSentences: number;
    savedCount: number;
    viewMode: ReaderViewMode;
    onChangeViewMode: (mode: ReaderViewMode) => void;
    filter: ScriptReaderFilter;
    onChangeFilter: (filter: ScriptReaderFilter) => void;
    searchQuery: string;
    onChangeSearchQuery: (query: string) => void;
    matchCount: number;
    showTranslation: boolean;
    onToggleTranslation: () => void;
    onOpenInPlayer: () => void;
    vocabSummary: readonly ScriptVocabPreviewItem[];
    sceneDividers: readonly SceneBoundary[];
    onJumpToSentenceIndex: (sentenceIndex: number) => void;
}

/**
 * 精读文稿顶部工具栏与听前预览条：
 * - 视图切换（逐句 / 讲稿）、筛选（全部 / 生词 / 有印象 / 金句）、文内搜索、译文切换与定位视频；
 * - 展示重点生词雷达与高置信度场景章节锚点，支持一键直达对应句子。
 */
export function ScriptReaderToolbar({
    title,
    totalSentences,
    savedCount,
    viewMode,
    onChangeViewMode,
    filter,
    onChangeFilter,
    searchQuery,
    onChangeSearchQuery,
    matchCount,
    showTranslation,
    onToggleTranslation,
    onOpenInPlayer,
    vocabSummary,
    sceneDividers,
    onJumpToSentenceIndex,
}: ScriptReaderToolbarProps) {
    const { t } = useTranslation('pages');

    return (
        <div className="shrink-0 border-b border-border/40 bg-surface/50 flex flex-col">
            {/* 第一行：主控制栏 */}
            <div className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0">
                        <SegmentedControl
                            size="sm"
                            value={viewMode}
                            onChange={(val) => onChangeViewMode(val as ReaderViewMode)}
                            label={t('scriptReader.viewModeLabel', { defaultValue: '阅读排版模式' })}
                        >
                            <SegmentedControlItem
                                value="sentence"
                                label={t('scriptReader.modeSentence', { defaultValue: '逐句' })}
                            />
                            <SegmentedControlItem
                                value="article"
                                label={t('scriptReader.modeArticle', { defaultValue: '讲稿' })}
                            />
                        </SegmentedControl>
                    </div>

                    <div className="min-w-0 flex flex-col">
                        <span className="text-sm font-medium text-primary truncate">{title}</span>
                        <span className="text-metadata text-secondary">
                            {t('scriptReader.docMeta', {
                                defaultValue: '共 {{total}} 句 · 收藏 {{saved}} 句',
                                total: totalSentences,
                                saved: savedCount,
                            })}
                        </span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* 文内搜索 */}
                    <div className="relative flex items-center">
                        <Search className="h-3.5 w-3.5 text-secondary absolute left-2.5 pointer-events-none" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => onChangeSearchQuery(e.target.value)}
                            placeholder={t('scriptReader.searchContent', { defaultValue: '搜文稿/译文...' })}
                            className="w-40 rounded-lg border border-border/50 bg-body pl-8 pr-7 py-1 text-sm text-primary placeholder:text-secondary/70 focus:outline-none focus:ring-2 focus:ring-accent/40"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => onChangeSearchQuery('')}
                                className="absolute right-2 text-secondary hover:text-primary cursor-pointer"
                                aria-label={t('scriptReader.clearSearch', { defaultValue: '清空搜索' })}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* 状态筛选：全部 / 生词 / 金句 */}
                    <div className="shrink-0">
                        <SegmentedControl
                            size="sm"
                            value={filter}
                            onChange={(val) => onChangeFilter(val as ScriptReaderFilter)}
                            label={t('scriptReader.filterLabel', { defaultValue: '筛选' })}
                        >
                            <SegmentedControlItem
                                value="all"
                                label={t('scriptReader.filterAll', { defaultValue: '全部' })}
                            />
                            <SegmentedControlItem
                                value="learning"
                                label={t('scriptReader.filterLearning', { defaultValue: '生词' })}
                            />
                            <SegmentedControlItem
                                value="saved"
                                label={t('scriptReader.filterSaved', { defaultValue: '金句' })}
                            />
                        </SegmentedControl>
                    </div>

                    {(searchQuery.trim() !== '' || filter !== 'all') && (
                        <span className="text-metadata text-secondary font-mono">
                            {t('scriptReader.matchCount', {
                                defaultValue: '{{count}} 句',
                                count: matchCount,
                            })}
                        </span>
                    )}

                    <Tooltip content={t('scriptReader.toggleTranslation', { defaultValue: '显示 / 隐藏中文译文' })} placement="below">
                        <button
                            type="button"
                            aria-pressed={showTranslation}
                            onClick={onToggleTranslation}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium transition-colors cursor-pointer',
                                showTranslation
                                    ? 'text-accent bg-accent-bg/15'
                                    : 'text-secondary hover:text-primary hover:bg-muted/80',
                            )}
                            aria-label={t('scriptReader.toggleTranslation', { defaultValue: '切换译文' })}
                        >
                            <Languages className="h-3.5 w-3.5 shrink-0" />
                            <span>{t('scriptReader.translationShort', { defaultValue: '译文' })}</span>
                        </button>
                    </Tooltip>

                    <Button
                        size="sm"
                        variant="secondary"
                        icon={<ExternalLink className="h-3.5 w-3.5" />}
                        label={t('scriptReader.openInPlayer', { defaultValue: '观看视频' })}
                        onClick={onOpenInPlayer}
                    />
                </div>
            </div>

            {/* 第二行（P1 增强）：听前生词雷达 + 场景章节快速跳转 */}
            {(vocabSummary.length > 0 || sceneDividers.length > 0) && (
                <div className="px-5 py-1.5 border-t border-border/30 bg-surface/30 flex flex-wrap items-center gap-3 text-metadata">
                    {vocabSummary.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="inline-flex items-center gap-1 text-secondary font-medium shrink-0">
                                <BookMarked className="h-3.5 w-3.5 text-accent" />
                                {t('scriptReader.vocabRadar', { defaultValue: '本篇生词' })}:
                            </span>
                            {vocabSummary.slice(0, 6).map((item) => (
                                <button
                                    key={item.word}
                                    type="button"
                                    onClick={() => onJumpToSentenceIndex(item.firstSentenceIndex)}
                                    className="rounded-md border border-border/40 bg-body/80 px-1.5 py-0.5 text-metadata text-primary hover:border-accent/60 hover:text-accent transition-colors cursor-pointer"
                                    title={t('scriptReader.jumpToWordSentence', {
                                        defaultValue: '跳转到包含 "{{word}}" 的句子',
                                        word: item.word,
                                    })}
                                >
                                    {item.word}
                                    {item.count > 1 ? ` ×${item.count}` : ''}
                                </button>
                            ))}
                        </div>
                    )}

                    {sceneDividers.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="inline-flex items-center gap-1 text-secondary font-medium shrink-0">
                                <Compass className="h-3.5 w-3.5 text-accent" />
                                {t('scriptReader.sceneChapters', { defaultValue: '章节' })}:
                            </span>
                            {sceneDividers.slice(0, 6).map((divider) => (
                                <button
                                    key={`${divider.sentenceIndex}-${divider.atSec}`}
                                    type="button"
                                    onClick={() => onJumpToSentenceIndex(divider.sentenceIndex)}
                                    className="rounded-md bg-muted/60 px-1.5 py-0.5 text-metadata font-mono text-secondary hover:bg-muted hover:text-primary transition-colors cursor-pointer"
                                >
                                    {TimeUtil.secondToTimeStrCompact(divider.atSec)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
