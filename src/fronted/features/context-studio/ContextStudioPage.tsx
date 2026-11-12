import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { t as i18nT } from 'i18next';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { Badge } from '@astryxdesign/core/Badge';
import {
    Bookmark,
    BookOpen,
    Clock,
    Download,
    Layers,
    Search,
    Sparkles,
    Upload,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import MemoryMapSection from '@/fronted/features/learning-data/MemoryMapSection';
import WordEditDialog from '@/fronted/features/video-learning/components/WordEditDialog';
import type { WordItem } from '@/fronted/features/video-learning/components/WordSidebar';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { contextStudioApi } from './contextStudioApi';
import WordDetailCanvas from './components/WordDetailCanvas';
import SentenceDetailCanvas from './components/SentenceDetailCanvas';
import type { SavedSentenceVO } from '@/common/types/contextStudio';
import type { WordStatus } from '@/common/types/vocabulary';
import { cn } from '@/fronted/lib/utils';

type AssetFilter = 'all' | 'words' | 'sentences' | 'due' | 'learning' | 'familiar' | 'known';
type SegmentFilter = 'all' | 'words' | 'sentences';

type StudioSelection =
    | { kind: 'word'; word: WordItem }
    | { kind: 'sentence'; sentence: SavedSentenceVO }
    | null;

const STATUS_BADGE_VARIANT: Record<WordStatus, 'warning' | 'teal' | 'success' | 'neutral'> = {
    learning: 'warning',
    familiar: 'teal',
    known: 'success',
    ignored: 'neutral',
};

const REVIEW_QUEUE_LIMIT = 50;
const LIST_PAGE_SIZE = 100;

interface StudioAssetsSnapshot {
    words?: WordItem[];
    sentences?: SavedSentenceVO[];
    dueWords?: Set<string>;
    dueCount?: number;
}

async function fetchStudioAssetsSnapshot(): Promise<StudioAssetsSnapshot> {
    const [wordsRes, sentencesRes, reviewRes] = await Promise.allSettled([
        videoLearningApi.getVocabulary(),
        contextStudioApi.listSavedSentences(),
        videoLearningApi.getReviewQueue(REVIEW_QUEUE_LIMIT),
    ]);

    const snapshot: StudioAssetsSnapshot = {};
    if (wordsRes.status === 'fulfilled' && wordsRes.value.success && Array.isArray(wordsRes.value.data)) {
        snapshot.words = wordsRes.value.data as WordItem[];
    }
    if (sentencesRes.status === 'fulfilled') {
        snapshot.sentences = sentencesRes.value;
    }
    if (reviewRes.status === 'fulfilled' && Array.isArray(reviewRes.value.items)) {
        snapshot.dueWords = new Set(reviewRes.value.items.map((card) => card.word.toLowerCase()));
        snapshot.dueCount = reviewRes.value.dueCount ?? reviewRes.value.items.length;
    }
    return snapshot;
}

export default function ContextStudioPage() {
    const { t } = useTranslation('pages');
    const [searchParams, setSearchParams] = useSearchParams();
    const deepLinkWord = searchParams.get('word')?.trim() ?? '';

    const [words, setWords] = useState<WordItem[]>([]);
    const [sentences, setSentences] = useState<SavedSentenceVO[]>([]);
    const [dueWords, setDueWords] = useState<Set<string>>(new Set());
    const [dueTotalCount, setDueTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [studioView, setStudioView] = useState<'workspace' | 'map'>('workspace');
    const [topicQueue, setTopicQueue] = useState<string[]>([]);

    const [activeFilter, setActiveFilter] = useState<AssetFilter>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [visibleLimit, setVisibleLimit] = useState(LIST_PAGE_SIZE);
    const [explicitSelection, setExplicitSelection] = useState<StudioSelection>(null);
    const [editingWord, setEditingWord] = useState<WordItem | null>(null);

    const loadAllAssets = useCallback(async () => {
        setLoading(true);
        try {
            const snapshot = await fetchStudioAssetsSnapshot();
            if (snapshot.words) setWords(snapshot.words);
            if (snapshot.sentences) setSentences(snapshot.sentences);
            if (snapshot.dueWords) setDueWords(snapshot.dueWords);
            if (snapshot.dueCount !== undefined) setDueTotalCount(snapshot.dueCount);
        } catch {
            toast.error(i18nT('pages:contextStudio.loadFailed', { defaultValue: '加载语境资产失败' }));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        void fetchStudioAssetsSnapshot()
            .then((snapshot) => {
                if (cancelled) return;
                if (snapshot.words) setWords(snapshot.words);
                if (snapshot.sentences) setSentences(snapshot.sentences);
                if (snapshot.dueWords) setDueWords(snapshot.dueWords);
                if (snapshot.dueCount !== undefined) setDueTotalCount(snapshot.dueCount);
            })
            .catch(() => {
                if (!cancelled) {
                    toast.error(i18nT('pages:contextStudio.loadFailed', { defaultValue: '加载语境资产失败' }));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // 根据深链 ?word= 派生选中状态，或使用显式选中
    const selection = useMemo<StudioSelection>(() => {
        if (explicitSelection) {
            return explicitSelection;
        }
        if (deepLinkWord) {
            const matched = words.find((w) => w.word.toLowerCase() === deepLinkWord.toLowerCase());
            if (matched) {
                return { kind: 'word', word: matched };
            }
            return {
                kind: 'word',
                word: {
                    id: -1,
                    word: deepLinkWord,
                    translate: '',
                    created_at: '',
                    updated_at: '',
                },
            };
        }
        if (words.length > 0) {
            return { kind: 'word', word: words[0] };
        }
        if (sentences.length > 0) {
            return { kind: 'sentence', sentence: sentences[0] };
        }
        return null;
    }, [deepLinkWord, explicitSelection, words, sentences]);

    const sortedWords = useMemo(() => {
        if (topicQueue.length === 0) {
            return words;
        }
        const order = new Map(topicQueue.map((w, idx) => [w.toLowerCase(), idx]));
        return words.slice().sort((a, b) => {
            const ia = order.get(a.word.toLowerCase());
            const ib = order.get(b.word.toLowerCase());
            if (ia === undefined && ib === undefined) return 0;
            if (ia === undefined) return 1;
            if (ib === undefined) return -1;
            return ia - ib;
        });
    }, [topicQueue, words]);

    // 统计各分类数量
    const counts = useMemo(() => {
        let learning = 0;
        let familiar = 0;
        let known = 0;
        let due = 0;
        for (const w of words) {
            const st = w.status ?? 'learning';
            if (st === 'learning') learning += 1;
            else if (st === 'familiar') familiar += 1;
            else if (st === 'known') known += 1;
            if (dueWords.has(w.word.toLowerCase())) due += 1;
        }
        return {
            all: words.length + sentences.length,
            words: words.length,
            sentences: sentences.length,
            due: Math.max(due, dueTotalCount),
            learning,
            familiar,
            known,
        };
    }, [words, sentences, dueWords, dueTotalCount]);

    const filteredItems = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        const showWords = activeFilter !== 'sentences';
        const showSentences = activeFilter === 'all' || activeFilter === 'sentences';

        const wordEntries = showWords
            ? sortedWords
                  .filter((w) => {
                      const st = w.status ?? 'learning';
                      if (activeFilter === 'due' && !dueWords.has(w.word.toLowerCase())) return false;
                      if (activeFilter === 'learning' && st !== 'learning') return false;
                      if (activeFilter === 'familiar' && st !== 'familiar') return false;
                      if (activeFilter === 'known' && st !== 'known') return false;
                      if (!q) return true;
                      return (
                          w.word.toLowerCase().includes(q) ||
                          (w.translate && w.translate.toLowerCase().includes(q))
                      );
                  })
                  .map((word) => ({ kind: 'word' as const, word }))
            : [];

        const sentenceEntries = showSentences
            ? sentences
                  .filter((s) => {
                      if (!q) return true;
                      return (
                          s.text.toLowerCase().includes(q) ||
                          s.textZh.toLowerCase().includes(q) ||
                          s.videoTitle.toLowerCase().includes(q)
                      );
                  })
                  .map((sentence) => ({ kind: 'sentence' as const, sentence }))
            : [];

        return [...sentenceEntries, ...wordEntries];
    }, [activeFilter, sortedWords, sentences, dueWords, searchTerm]);

    const segmentValue: SegmentFilter =
        activeFilter === 'sentences'
            ? 'sentences'
            : activeFilter === 'words' || activeFilter === 'due' || activeFilter === 'learning' || activeFilter === 'familiar' || activeFilter === 'known'
                ? 'words'
                : 'all';

    const handleSegmentChange = (val: string) => {
        setActiveFilter(val as SegmentFilter);
    };

    const handleMemoryMapWord = useCallback(
        (wordText: string) => {
            const found = words.find((w) => w.word.toLowerCase() === wordText.toLowerCase());
            if (found) {
                setExplicitSelection({ kind: 'word', word: found });
            } else {
                setSearchParams({ word: wordText });
                setExplicitSelection(null);
            }
            setActiveFilter('words');
            setStudioView('workspace');
        },
        [words, setSearchParams],
    );

    const handleStartTopicQueue = useCallback(
        (queue: string[]) => {
            setTopicQueue(queue);
            setActiveFilter('words');
            setStudioView('workspace');
            if (queue[0]) {
                const found = words.find((w) => w.word.toLowerCase() === queue[0].toLowerCase());
                if (found) {
                    setExplicitSelection({ kind: 'word', word: found });
                }
            }
            toast.success(
                t('contextStudio.topicQueueStarted', {
                    count: queue.length,
                    defaultValue: `已按主题优先级排列 ${queue.length} 个词汇`,
                }),
            );
        },
        [words, t],
    );

    const handleExportTemplate = async () => {
        try {
            const res = await videoLearningApi.exportVocabularyTemplate();
            if (res.success && res.data) {
                const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'context-studio-words.txt';
                a.click();
                URL.revokeObjectURL(url);
                toast.success(t('vocabularyStudio.exportSuccess', { defaultValue: '导出成功' }));
            }
        } catch {
            toast.error(t('vocabularyStudio.exportFailed', { defaultValue: '导出失败' }));
        }
    };

    const handleImportWords = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.csv';
        input.onchange = async () => {
            const file = input.files?.[0] as (File & { path?: string }) | undefined;
            if (!file?.path) return;
            try {
                const res = await videoLearningApi.importVocabulary(file.path);
                if (res.success) {
                    toast.success(res.message || t('vocabularyStudio.importSuccess', { defaultValue: '导入成功' }));
                    void loadAllAssets();
                } else {
                    toast.error(res.error || t('vocabularyStudio.importFailed', { defaultValue: '导入失败' }));
                }
            } catch {
                toast.error(t('vocabularyStudio.importFailed', { defaultValue: '导入失败' }));
            }
        };
        input.click();
    };

    const navButtonClass = (active: boolean) =>
        cn(
            'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer text-left',
            active
                ? 'bg-accent-bg/12 text-accent font-medium'
                : 'text-secondary hover:text-primary hover:bg-muted/60',
        );

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-body">
            {/* 顶部页面标题栏 */}
            <div className="px-6 pt-5 pb-2 shrink-0">
                <PageHeader
                    title={t('contextStudio.title', { defaultValue: '语境工坊' })}
                    description={t('contextStudio.description', {
                        defaultValue: '真实视频语境中的生词与金句',
                    })}
                    rightSlot={
                        <div className="flex items-center gap-2.5">
                            <div className="shrink-0">
                                <SegmentedControl
                                    size="sm"
                                    value={studioView}
                                    onChange={(val) => setStudioView(val === 'map' ? 'map' : 'workspace')}
                                    label={t('contextStudio.viewModeLabel', { defaultValue: '工坊视图切换' })}
                                >
                                    <SegmentedControlItem
                                        value="workspace"
                                        label={t('contextStudio.viewWorkspace', { defaultValue: '工作台' })}
                                    />
                                    <SegmentedControlItem
                                        value="map"
                                        label={t('contextStudio.viewMap', { defaultValue: '记忆图谱' })}
                                    />
                                </SegmentedControl>
                            </div>
                            <Button
                                size="sm"
                                variant="secondary"
                                icon={<Upload className="w-3.5 h-3.5" />}
                                label={t('contextStudio.importWords', { defaultValue: '导入' })}
                                onClick={() => void handleImportWords()}
                            />
                            <Button
                                size="sm"
                                variant="secondary"
                                icon={<Download className="w-3.5 h-3.5" />}
                                label={t('contextStudio.exportTemplate', { defaultValue: '导出' })}
                                onClick={() => void handleExportTemplate()}
                            />
                        </div>
                    }
                />
            </div>

            {/* 主体工作区：三栏工作台 ↔ 全屏记忆图谱 */}
            <div className="flex-1 min-h-0 px-6 pb-5 pt-2 overflow-hidden">
                {studioView === 'map' ? (
                    <Card padding={0} height="100%" className="h-full min-h-0 flex flex-col overflow-hidden">
                        <div className="flex-1 min-h-0 overflow-y-auto p-5">
                            <MemoryMapSection
                                defaultExpanded
                                hideCollapseToggle
                                onSelectWord={handleMemoryMapWord}
                                onStartTopicQueue={handleStartTopicQueue}
                            />
                        </div>
                    </Card>
                ) : (
                <Card padding={0} height="100%" className="h-full min-h-0 flex overflow-hidden">
                    {/* 左栏：分类与记忆阶段筛选 */}
                    <aside className="w-52 shrink-0 border-r border-border/40 bg-surface/40 p-3 flex flex-col gap-4 overflow-y-auto">
                        <div className="flex flex-col gap-1">
                            <span className="px-2.5 pb-1 text-metadata font-medium text-secondary">
                                {t('contextStudio.navCategory', { defaultValue: '资产分类' })}
                            </span>
                            <button
                                type="button"
                                className={navButtonClass(activeFilter === 'all')}
                                onClick={() => setActiveFilter('all')}
                            >
                                <span className="flex items-center gap-2 truncate">
                                    <Layers className="w-3.5 h-3.5 shrink-0" />
                                    <span>{t('contextStudio.filterAll', { defaultValue: '全部资产' })}</span>
                                </span>
                                <span className="text-metadata tabular-nums opacity-80">{counts.all}</span>
                            </button>
                            <button
                                type="button"
                                className={navButtonClass(activeFilter === 'words')}
                                onClick={() => setActiveFilter('words')}
                            >
                                <span className="flex items-center gap-2 truncate">
                                    <BookOpen className="w-3.5 h-3.5 shrink-0" />
                                    <span>{t('contextStudio.filterWords', { defaultValue: '生词库' })}</span>
                                </span>
                                <span className="text-metadata tabular-nums opacity-80">{counts.words}</span>
                            </button>
                            <button
                                type="button"
                                className={navButtonClass(activeFilter === 'sentences')}
                                onClick={() => setActiveFilter('sentences')}
                            >
                                <span className="flex items-center gap-2 truncate">
                                    <Bookmark className="w-3.5 h-3.5 shrink-0" />
                                    <span>{t('contextStudio.filterSentences', { defaultValue: '收藏金句' })}</span>
                                </span>
                                <span className="text-metadata tabular-nums opacity-80">{counts.sentences}</span>
                            </button>
                        </div>

                        <div className="flex flex-col gap-1">
                            <span className="px-2.5 pb-1 text-metadata font-medium text-secondary">
                                {t('contextStudio.navMemory', { defaultValue: '记忆与复习' })}
                            </span>
                            <button
                                type="button"
                                className={navButtonClass(activeFilter === 'due')}
                                onClick={() => setActiveFilter('due')}
                            >
                                <span className="flex items-center gap-2 truncate">
                                    <Clock className="w-3.5 h-3.5 shrink-0 text-warning-text" />
                                    <span>{t('contextStudio.filterDue', { defaultValue: '今日待复习' })}</span>
                                </span>
                                <span className="text-metadata tabular-nums font-medium text-warning-text">{counts.due}</span>
                            </button>
                            <button
                                type="button"
                                className={navButtonClass(activeFilter === 'learning')}
                                onClick={() => setActiveFilter('learning')}
                            >
                                <span className="truncate">{t('contextStudio.status.learning', { defaultValue: '待学' })}</span>
                                <span className="text-metadata tabular-nums opacity-80">{counts.learning}</span>
                            </button>
                            <button
                                type="button"
                                className={navButtonClass(activeFilter === 'familiar')}
                                onClick={() => setActiveFilter('familiar')}
                            >
                                <span className="truncate">{t('contextStudio.status.familiar', { defaultValue: '有印象' })}</span>
                                <span className="text-metadata tabular-nums opacity-80">{counts.familiar}</span>
                            </button>
                            <button
                                type="button"
                                className={navButtonClass(activeFilter === 'known')}
                                onClick={() => setActiveFilter('known')}
                            >
                                <span className="truncate">{t('contextStudio.status.known', { defaultValue: '已掌握' })}</span>
                                <span className="text-metadata tabular-nums opacity-80">{counts.known}</span>
                            </button>
                        </div>
                    </aside>

                    {/* 中栏：资产卡片流 */}
                    <section className="w-80 shrink-0 border-r border-border/40 flex flex-col min-h-0 bg-body/40">
                        <div className="p-3 border-b border-border/40 flex flex-col gap-2.5 shrink-0">
                            <div className="relative flex items-center">
                                <Search className="w-3.5 h-3.5 text-secondary absolute left-2.5 pointer-events-none" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder={t('contextStudio.searchPlaceholder', {
                                        defaultValue: '搜索词汇、金句或视频...',
                                    })}
                                    className="w-full rounded-lg border border-border/50 bg-surface pl-8 pr-3 py-1.5 text-sm text-primary placeholder:text-secondary/70 focus:outline-none focus:ring-2 focus:ring-accent/40"
                                />
                            </div>
                            <div className="shrink-0">
                                <SegmentedControl
                                    size="sm"
                                    layout="fill"
                                    value={segmentValue}
                                    onChange={handleSegmentChange}
                                    label={t('contextStudio.assetTypeSegment', { defaultValue: '资产类型切换' })}
                                >
                                    <SegmentedControlItem
                                        value="all"
                                        label={t('contextStudio.segmentAll', { defaultValue: '全部' })}
                                    />
                                    <SegmentedControlItem
                                        value="words"
                                        label={t('contextStudio.segmentWords', { defaultValue: '生词' })}
                                    />
                                    <SegmentedControlItem
                                        value="sentences"
                                        label={t('contextStudio.segmentSentences', { defaultValue: '金句' })}
                                    />
                                </SegmentedControl>
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5">
                            {loading ? (
                                <div className="p-6 text-center text-sm text-secondary">
                                    {t('contextStudio.loading', { defaultValue: '正在加载语境资产...' })}
                                </div>
                            ) : filteredItems.length === 0 ? (
                                <div className="p-6 text-center text-sm text-secondary">
                                    {t('contextStudio.emptyList', { defaultValue: '暂无符合条件的语境资产' })}
                                </div>
                            ) : (
                                <>
                                    {filteredItems.slice(0, visibleLimit).map((entry) => {
                                        if (entry.kind === 'sentence') {
                                        const isSelected =
                                            selection?.kind === 'sentence' &&
                                            selection.sentence.sentenceKey === entry.sentence.sentenceKey;
                                        return (
                                            <button
                                                key={`sent-${entry.sentence.sentenceKey}`}
                                                type="button"
                                                onClick={() => setExplicitSelection({ kind: 'sentence', sentence: entry.sentence })}
                                                className={cn(
                                                    'w-full text-left rounded-lg border p-2.5 transition-colors cursor-pointer flex flex-col gap-1',
                                                    isSelected
                                                        ? 'bg-accent-bg/10 border-accent-bg/40'
                                                        : 'bg-surface/40 border-transparent hover:bg-muted/60',
                                                )}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="inline-flex items-center gap-1 text-metadata font-medium text-accent">
                                                        <Bookmark className="w-3 h-3 fill-current" />
                                                        <span>{t('contextStudio.sentenceBadge', { defaultValue: '金句' })}</span>
                                                    </span>
                                                    <span className="text-metadata text-secondary truncate">
                                                        {entry.sentence.videoTitle}
                                                    </span>
                                                </div>
                                                <p className="text-sm font-medium text-primary line-clamp-2 leading-snug">
                                                    {entry.sentence.text}
                                                </p>
                                                {entry.sentence.textZh && (
                                                    <p className="text-metadata text-secondary line-clamp-1">
                                                        {entry.sentence.textZh}
                                                    </p>
                                                )}
                                            </button>
                                        );
                                    }

                                    const isSelected =
                                        selection?.kind === 'word' &&
                                        selection.word.word.toLowerCase() === entry.word.word.toLowerCase();
                                    const status: WordStatus = entry.word.status ?? 'learning';
                                    const isDue = dueWords.has(entry.word.word.toLowerCase());

                                    return (
                                        <button
                                            key={`word-${entry.word.id}-${entry.word.word}`}
                                            type="button"
                                            onClick={() => setExplicitSelection({ kind: 'word', word: entry.word })}
                                            className={cn(
                                                'w-full text-left rounded-lg border p-2.5 transition-colors cursor-pointer flex flex-col gap-1',
                                                isSelected
                                                    ? 'bg-accent-bg/10 border-accent-bg/40'
                                                    : 'bg-surface/40 border-transparent hover:bg-muted/60',
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold text-primary truncate">
                                                    {entry.word.word}
                                                </span>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    {isDue && (
                                                        <span
                                                            className="w-1.5 h-1.5 rounded-full bg-warning-text"
                                                            title={t('contextStudio.dueBadge', { defaultValue: '今日待复习' })}
                                                        />
                                                    )}
                                                    <Badge
                                                        variant={STATUS_BADGE_VARIANT[status]}
                                                        label={t(`contextStudio.status.${status}`, {
                                                            defaultValue:
                                                                status === 'learning'
                                                                    ? '待学'
                                                                    : status === 'familiar'
                                                                        ? '有印象'
                                                                        : status === 'known'
                                                                            ? '已掌握'
                                                                            : '忽略',
                                                        })}
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-metadata text-secondary line-clamp-1">
                                                {entry.word.translate?.trim() || t('contextStudio.noTranslation', { defaultValue: '暂无释义' })}
                                            </p>
                                        </button>
                                    );
                                    })}
                                    {filteredItems.length > visibleLimit && (
                                        <div className="pt-1 pb-2 flex justify-center">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setVisibleLimit((prev) => prev + LIST_PAGE_SIZE)}
                                                label={t('contextStudio.loadMore', {
                                                    count: filteredItems.length - visibleLimit,
                                                    defaultValue: `加载更多（剩余 ${filteredItems.length - visibleLimit} 条）`,
                                                })}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </section>

                    {/* 右栏：沉浸式语境画布 */}
                    <main className="flex-1 min-w-0 h-full bg-body/60 flex flex-col">
                        {selection?.kind === 'word' ? (
                            <WordDetailCanvas
                                key={selection.word.word}
                                word={selection.word}
                                isDueForReview={dueWords.has(selection.word.word.toLowerCase())}
                                onEdit={setEditingWord}
                                onDeleted={(deletedText) => {
                                    setWords((prev) => prev.filter((w) => w.word !== deletedText));
                                    setExplicitSelection(null);
                                }}
                                onStatusUpdated={(wordText, nextStatus) => {
                                    setWords((prev) =>
                                        prev.map((w) => (w.word === wordText ? { ...w, status: nextStatus } : w)),
                                    );
                                }}
                                onReviewRated={(wordText) => {
                                    setDueWords((prev) => {
                                        const next = new Set(prev);
                                        next.delete(wordText.toLowerCase());
                                        return next;
                                    });
                                    setDueTotalCount((prev) => Math.max(0, prev - 1));
                                }}
                            />
                        ) : selection?.kind === 'sentence' ? (
                            <SentenceDetailCanvas
                                key={selection.sentence.sentenceKey}
                                sentence={selection.sentence}
                                onUpdated={(updated) => {
                                    setSentences((prev) =>
                                        prev.map((s) => (s.sentenceKey === updated.sentenceKey ? updated : s)),
                                    );
                                    setExplicitSelection({ kind: 'sentence', sentence: updated });
                                }}
                                onRemoved={(removedKey) => {
                                    setSentences((prev) => prev.filter((s) => s.sentenceKey !== removedKey));
                                    setExplicitSelection(null);
                                }}
                            />
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-3">
                                <Sparkles className="w-8 h-8 text-secondary/60" />
                                <Text type="body" weight="medium">
                                    {t('contextStudio.emptyCanvasTitle', { defaultValue: '欢迎来到语境工坊' })}
                                </Text>
                                <Text type="supporting" color="secondary" className="max-w-md">
                                    {t('contextStudio.emptyCanvasDesc', {
                                        defaultValue: '在播放实验室或精读文稿中查词、收藏生词或点击句尾书签收藏金句，所有学习资产都会按真实视频语境沉淀在这里。',
                                    })}
                                </Text>
                            </div>
                        )}
                    </main>
                </Card>
                )}
            </div>

            <WordEditDialog
                open={!!editingWord}
                wordItem={editingWord}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditingWord(null);
                    }
                }}
                onSaved={(newWord) => {
                    void loadAllAssets().then(() => {
                        setSearchParams({ word: newWord });
                        setExplicitSelection(null);
                    });
                }}
            />
        </div>
    );
}
