import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { t as i18nT } from 'i18next';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { BookOpenText, Bookmark, ExternalLink, FileText, Languages, Search, Volume2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import PageHeader from '@/fronted/components/shared/common/PageHeader';
import { contextStudioApi } from '@/fronted/features/context-studio/contextStudioApi';
import { useSavedSentences } from '@/fronted/features/context-studio/savedSentencesStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import { groupSentencesIntoBlocks } from '@/fronted/features/player/lib/sentence-grouping';
import { playContextAudio } from '@/fronted/infrastructure/audio/AudioPlayer';
import TimeUtil from '@/common/utils/TimeUtil';
import type { ReaderDocumentSummary } from '@/common/types/contextStudio';
import type { Sentence } from '@/common/types/SentenceC';
import { cn } from '@/fronted/lib/utils';

type ReaderViewMode = 'sentence' | 'article';

export default function ScriptReaderPage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const { videoId: routeVideoId } = useParams<{ videoId?: string }>();

    const [documents, setDocuments] = useState<ReaderDocumentSummary[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [docQuery, setDocQuery] = useState('');
    const [selectedVideoId, setSelectedVideoId] = useState<string>(routeVideoId ?? '');

    const [sentences, setSentences] = useState<Sentence[]>([]);
    const [loadedScriptVideoId, setLoadedScriptVideoId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ReaderViewMode>('sentence');
    const [showTranslation, setShowTranslation] = useState(true);
    const [speakingKey, setSpeakingKey] = useState<string | null>(null);

    const savedKeys = useSavedSentences((s) => s.savedKeys);
    const toggleSavedSentence = useSavedSentences((s) => s.toggleSentence);

    useEffect(() => {
        let cancelled = false;
        void contextStudioApi
            .listReaderDocuments()
            .then((docs) => {
                if (cancelled) return;
                setDocuments(docs);
                setSelectedVideoId((prev) => routeVideoId || prev || docs[0]?.videoId || '');
            })
            .catch(() => {
                if (!cancelled) {
                    toast.error(i18nT('pages:scriptReader.loadDocsFailed', { defaultValue: '加载文稿列表失败' }));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingDocs(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [routeVideoId]);

    const activeDoc = useMemo(
        () => documents.find((d) => d.videoId === selectedVideoId) ?? null,
        [documents, selectedVideoId],
    );

    const loadingScript = Boolean(activeDoc) && loadedScriptVideoId !== activeDoc?.videoId;
    const activeSentences = useMemo(() => (activeDoc ? sentences : []), [activeDoc, sentences]);

    useEffect(() => {
        if (!activeDoc) {
            return;
        }
        let cancelled = false;
        void useSavedSentences.getState().loadForVideo(activeDoc.videoId);

        void playerApi
            .parseSubtitleToSentences({
                subtitlePath: activeDoc.srtFile,
                videoId: activeDoc.videoId,
                playbackSessionId: `reader-${activeDoc.videoId}-${Date.now()}`,
            })
            .then((parsed) => {
                if (cancelled) return;
                setSentences(parsed?.sentences ?? []);
            })
            .catch(() => {
                if (!cancelled) {
                    setSentences([]);
                    toast.error(i18nT('pages:scriptReader.parseFailed', { defaultValue: '解析文稿字幕失败' }));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadedScriptVideoId(activeDoc.videoId);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [activeDoc]);

    const filteredDocs = useMemo(() => {
        const q = docQuery.trim().toLowerCase();
        if (!q) return documents;
        return documents.filter((d) => d.title.toLowerCase().includes(q));
    }, [documents, docQuery]);

    const blocks = useMemo(() => groupSentencesIntoBlocks(activeSentences), [activeSentences]);

    const handleSpeakSentence = useCallback(
        async (sentence: Sentence, key: string) => {
            setSpeakingKey(key);
            try {
                await playContextAudio({
                    text: sentence.text,
                    videoPath: activeDoc?.videoPath,
                    startTime: sentence.adjustedStart ?? sentence.start,
                    endTime: sentence.adjustedEnd ?? sentence.end,
                });
            } finally {
                setSpeakingKey(null);
            }
        },
        [activeDoc?.videoPath],
    );

    const handleToggleSave = useCallback(
        (sentence: Sentence) => {
            if (!activeDoc) return;
            const sentenceKey = `${sentence.fileHash}:${sentence.index}`;
            void toggleSavedSentence({
                sentenceKey,
                videoId: activeDoc.videoId,
                videoTitle: activeDoc.title,
                fileHash: sentence.fileHash,
                sentenceIndex: sentence.index,
                startTime: sentence.adjustedStart ?? sentence.start,
                endTime: sentence.adjustedEnd ?? sentence.end,
                text: sentence.text,
                textZh: sentence.textZH || '',
            })
                .then((saved) => {
                    toast.success(
                        saved
                            ? t('scriptReader.savedToast', { defaultValue: '已收藏金句' })
                            : t('scriptReader.unsavedToast', { defaultValue: '已取消收藏' }),
                    );
                })
                .catch(() => {
                    toast.error(t('scriptReader.saveFailed', { defaultValue: '操作失败' }));
                });
        },
        [activeDoc, toggleSavedSentence, t],
    );

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-background">
            {/* 顶栏标题 */}
            <div className="px-6 pt-5 pb-2 shrink-0">
                <PageHeader
                    title={t('scriptReader.title', { defaultValue: '精读文稿' })}
                    description={t('scriptReader.description', {
                        defaultValue: '双语对照阅读视频文稿',
                    })}
                />
            </div>

            {/* 双栏精读工作区 */}
            <div className="flex-1 min-h-0 px-6 pb-5 pt-2 overflow-hidden">
                <Card padding={0} height="100%" className="h-full min-h-0 flex overflow-hidden">
                    {/* 左栏：文稿目录 */}
                    <aside className="w-64 shrink-0 border-r border-border/40 bg-surface/40 flex flex-col min-h-0">
                        <div className="p-3 border-b border-border/40 shrink-0">
                            <div className="relative flex items-center">
                                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 pointer-events-none" />
                                <input
                                    type="text"
                                    value={docQuery}
                                    onChange={(e) => setDocQuery(e.target.value)}
                                    placeholder={t('scriptReader.searchDocs', { defaultValue: '搜索文稿...' })}
                                    className="w-full rounded-lg border border-border/50 bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent/40"
                                />
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1">
                            {loadingDocs ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                    {t('scriptReader.loadingDocs', { defaultValue: '加载文稿中...' })}
                                </div>
                            ) : filteredDocs.length === 0 ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                    {t('scriptReader.emptyDocs', { defaultValue: '暂无文稿' })}
                                </div>
                            ) : (
                                filteredDocs.map((doc) => {
                                    const active = doc.videoId === activeDoc?.videoId;
                                    return (
                                        <button
                                            key={doc.videoId}
                                            type="button"
                                            onClick={() => setSelectedVideoId(doc.videoId)}
                                            className={cn(
                                                'w-full text-left rounded-lg px-2.5 py-2 transition-colors cursor-pointer flex items-start gap-2',
                                                active
                                                    ? 'bg-accent/12 text-accent font-medium'
                                                    : 'text-foreground/80 hover:bg-muted/60',
                                            )}
                                        >
                                            <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-75" />
                                            <span className="text-sm line-clamp-2 leading-snug">{doc.title}</span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </aside>

                    {/* 右栏：阅读画布 */}
                    <main className="flex-1 min-w-0 flex flex-col min-h-0 bg-background/60">
                        {activeDoc ? (
                            <>
                                {/* 阅读控制栏 */}
                                <div className="shrink-0 px-5 py-2.5 border-b border-border/40 flex items-center justify-between gap-4 bg-surface/50">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="shrink-0">
                                            <SegmentedControl
                                                size="sm"
                                                value={viewMode}
                                                onChange={(val) => setViewMode(val as ReaderViewMode)}
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
                                        <span className="text-sm font-medium text-foreground truncate">
                                            {activeDoc.title}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <Tooltip
                                            content={t('scriptReader.toggleTranslation', { defaultValue: '切换译文' })}
                                            placement="below"
                                        >
                                            <button
                                                type="button"
                                                aria-pressed={showTranslation}
                                                onClick={() => setShowTranslation((prev) => !prev)}
                                                className={cn(
                                                    'p-1.5 rounded-lg transition-colors cursor-pointer',
                                                    showTranslation
                                                        ? 'text-accent bg-accent/15'
                                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                                                )}
                                                aria-label={t('scriptReader.toggleTranslation', { defaultValue: '切换译文' })}
                                            >
                                                <Languages className="w-4 h-4" />
                                            </button>
                                        </Tooltip>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            icon={<ExternalLink className="w-3.5 h-3.5" />}
                                            label={t('scriptReader.openInPlayer', { defaultValue: '观看视频' })}
                                            onClick={() => navigate(`/player/${activeDoc.videoId}`)}
                                        />
                                    </div>
                                </div>

                                {/* 沉浸式正文排版区 */}
                                <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
                                    {loadingScript ? (
                                        <div className="py-12 text-center text-sm text-muted-foreground">
                                            {t('scriptReader.loadingScript', { defaultValue: '加载文稿中...' })}
                                        </div>
                                    ) : activeSentences.length === 0 ? (
                                        <div className="py-12 text-center text-sm text-muted-foreground">
                                            {t('scriptReader.emptyScript', { defaultValue: '暂无字幕内容' })}
                                        </div>
                                    ) : viewMode === 'sentence' ? (
                                        <div className="max-w-3xl mx-auto flex flex-col gap-3">
                                            {activeSentences.map((s) => {
                                                const key = `${s.fileHash}:${s.index}`;
                                                const isSaved = savedKeys.has(key);
                                                return (
                                                    <div
                                                        key={key}
                                                        className="group rounded-lg border border-border/30 bg-surface/40 px-4 py-3 hover:border-border/70 transition-colors flex items-start justify-between gap-4"
                                                    >
                                                        <div className="flex flex-col gap-1.5 min-w-0">
                                                            <span className="text-metadata font-mono text-muted-foreground">
                                                                {TimeUtil.secondToTimeStrCompact(s.adjustedStart ?? s.start)}
                                                            </span>
                                                            <p className="text-base text-foreground leading-relaxed select-text">
                                                                {s.text}
                                                            </p>
                                                            {showTranslation && s.textZH && (
                                                                <p className="text-sm text-muted-foreground leading-relaxed select-text">
                                                                    {s.textZH}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div
                                                            className={cn(
                                                                'flex items-center gap-1 shrink-0 transition-opacity',
                                                                isSaved ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                                                            )}
                                                        >
                                                            <Tooltip content={t('scriptReader.speakSentence', { defaultValue: '播放原声' })} placement="below">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleSpeakSentence(s, key)}
                                                                    className={cn(
                                                                        'p-1.5 rounded-md transition-colors cursor-pointer',
                                                                        speakingKey === key
                                                                            ? 'text-accent bg-accent/15'
                                                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                                                                    )}
                                                                    aria-label={t('scriptReader.speakSentence', { defaultValue: '播放原声' })}
                                                                >
                                                                    <Volume2 className="w-3.5 h-3.5" />
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
                                                                    onClick={() => handleToggleSave(s)}
                                                                    className={cn(
                                                                        'p-1.5 rounded-md transition-colors cursor-pointer',
                                                                        isSaved
                                                                            ? 'text-accent bg-accent/15'
                                                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                                                                    )}
                                                                    aria-label={
                                                                        isSaved
                                                                            ? t('scriptReader.unsaveSentence', { defaultValue: '取消收藏' })
                                                                            : t('scriptReader.saveSentence', { defaultValue: '收藏金句' })
                                                                    }
                                                                >
                                                                    <Bookmark className={cn('w-3.5 h-3.5', isSaved && 'fill-current')} />
                                                                </button>
                                                            </Tooltip>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="max-w-3xl mx-auto flex flex-col gap-6">
                                            {blocks.map((block, idx) => (
                                                <article
                                                    key={`block-${idx}`}
                                                    className="rounded-lg border border-border/30 bg-surface/30 p-5 flex flex-col gap-3"
                                                >
                                                    <p className="text-base text-foreground leading-loose select-text">
                                                        {block.sentences.map((s) => s.text).join(' ')}
                                                    </p>
                                                    {showTranslation && (
                                                        <p className="text-sm text-muted-foreground leading-relaxed select-text border-t border-border/30 pt-2.5">
                                                            {block.sentences
                                                                .map((s) => s.textZH)
                                                                .filter(Boolean)
                                                                .join(' ')}
                                                        </p>
                                                    )}
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-3">
                                <BookOpenText className="w-8 h-8 text-muted-foreground/60" />
                                <Text type="body" weight="medium">
                                    {t('scriptReader.emptySelectTitle', { defaultValue: '选择左侧文稿开始阅读' })}
                                </Text>
                                <Text type="supporting" color="secondary" className="max-w-sm">
                                    {t('scriptReader.emptySelectDesc', {
                                        defaultValue: '支持逐句、讲稿排版切换，试听原声并收藏金句。',
                                    })}
                                </Text>
                            </div>
                        )}
                    </main>
                </Card>
            </div>
        </div>
    );
}
