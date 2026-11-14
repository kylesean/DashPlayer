import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { t as i18nT } from 'i18next';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Card } from '@astryxdesign/core/Card';
import { Text } from '@astryxdesign/core/Text';
import { BookOpenText } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useShallow } from 'zustand/react/shallow';

import {
    selectSceneDividers,
    type SceneBoundary,
    type SceneSentence,
} from '@/common/learning/sceneSegmentation';
import type {
    ReaderDocumentSummary,
    SavedSentenceTag,
    SavedSentenceVO,
} from '@/common/types/contextStudio';
import type { Sentence } from '@/common/types/SentenceC';
import PageHeader from '@/frontend/components/shared/common/PageHeader';
import { contextStudioApi } from '@/frontend/features/context-studio/contextStudioApi';
import { useSavedSentences } from '@/frontend/features/context-studio/savedSentencesStore';
import { groupSentencesIntoBlocks } from '@/frontend/features/player/lib/sentence-grouping';
import { usePlaybackSession } from '@/frontend/features/player/playbackSessionStore';
import { playerApi } from '@/frontend/features/player/playerApi';
import {
    EMPTY_SENTENCE_VOCABULARY_COUNT,
    sentenceVocabularyKey,
    useTranscriptVocabularyCounts,
} from '@/frontend/features/player/transcriptVocabulary';
import { useVocabularyState, useVocabularyStore } from '@/frontend/features/player/vocabularyStore';
import useSubtitleTranslation, { EMPTY_TRANSLATIONS } from '@/frontend/features/player/translationStore';
import { ScriptArticleBlock } from './components/ScriptArticleBlock';
import { ScriptAudioBar } from './components/ScriptAudioBar';
import { ScriptDocSidebar } from './components/ScriptDocSidebar';
import { ScriptReaderToolbar, type ReaderViewMode } from './components/ScriptReaderToolbar';
import { ScriptSentenceRow } from './components/ScriptSentenceRow';
import { useScriptAudioReader } from './hooks/useScriptAudioReader';
import {
    collectReaderVocabularySummary,
    filterReaderSentences,
    getSavedReaderProgress,
    saveReaderProgress,
    type ScriptReaderFilter,
} from './lib/readerProgress';

const VIRTUALIZE_SENTENCE_THRESHOLD = 60;
const VIRTUALIZE_BLOCK_THRESHOLD = 40;

export default function ScriptReaderPage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const { videoId: routeVideoId } = useParams<{ videoId?: string }>();
    const [searchParams] = useSearchParams();
    const deepLinkSentenceRaw = searchParams.get('sentence');
    const playingVideoId = usePlaybackSession((s) => s.videoId);

    const [documents, setDocuments] = useState<ReaderDocumentSummary[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [docQuery, setDocQuery] = useState('');
    const [selectedVideoId, setSelectedVideoId] = useState<string>(routeVideoId ?? '');

    const [sentences, setSentences] = useState<Sentence[]>([]);
    const [loadedScriptVideoId, setLoadedScriptVideoId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ReaderViewMode>('sentence');
    const [filter, setFilter] = useState<ScriptReaderFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showTranslation, setShowTranslation] = useState(true);
    const [popEle, setPopEle] = useState<string | null>(null);
    const [openNoteKey, setOpenNoteKey] = useState<string | null>(null);
    const [sceneDividers, setSceneDividers] = useState<SceneBoundary[]>([]);
    const [savedByKey, setSavedByKey] = useState<Map<string, SavedSentenceVO>>(() => new Map());

    const savedKeys = useSavedSentences((s) => s.savedKeys);
    const toggleSavedSentence = useSavedSentences((s) => s.toggleSentence);
    const { getWordStatus, version: vocabVersion } = useVocabularyState(
        useShallow((s) => ({
            getWordStatus: s.getWordStatus,
            version: s.version,
        })),
    );

    const sentenceVirtuosoRef = useRef<VirtuosoHandle | null>(null);
    const blockVirtuosoRef = useRef<VirtuosoHandle | null>(null);
    const plainScrollerRef = useRef<HTMLDivElement | null>(null);
    const showTranslationRef = useRef(showTranslation);
    useEffect(() => {
        showTranslationRef.current = showTranslation;
    });

    const requestReaderTranslation = useCallback((fileHash: string | undefined, sentenceIndex: number) => {
        if (!fileHash || !showTranslationRef.current) {
            return;
        }
        const store = useSubtitleTranslation.getState();
        if (store.activeFileHash !== fileHash) {
            store.setActiveFileHash(fileHash);
        }
        store.requestTranslation(fileHash, Math.max(0, sentenceIndex));
    }, []);

    // 加载文稿列表
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

    const handleSelectDoc = useCallback((nextVideoId: string) => {
        setSelectedVideoId(nextVideoId);
        setFilter('all');
        setSearchQuery('');
        setOpenNoteKey(null);
        setPopEle(null);
        setSceneDividers([]);
    }, []);

    // 加载当前文稿字幕、收藏金句笔记、生词高亮状态与场景章节分割
    useEffect(() => {
        if (!activeDoc) {
            return;
        }
        let cancelled = false;

        void useSavedSentences.getState().loadForVideo(activeDoc.videoId);
        if (typeof contextStudioApi.listSavedSentences === 'function') {
            void contextStudioApi
                .listSavedSentences()
                .then((items) => {
                    if (cancelled) return;
                    const map = new Map<string, SavedSentenceVO>();
                    for (const item of items) {
                        if (item.videoId === activeDoc.videoId) {
                            map.set(item.sentenceKey, item);
                        }
                    }
                    setSavedByKey(map);
                })
                .catch(() => {
                    // 列表补充失败不影响金句键展示
                });
        }

        const sessionId = `reader-${activeDoc.videoId}-${Date.now()}`;
        const activateDocSubtitle = async () => {
            if (typeof playerApi.getPlayerDetail === 'function') {
                try {
                    await playerApi.getPlayerDetail(activeDoc.videoId);
                } catch {
                    // 忽略轻量详情读取失败，继续尝试解析字幕
                }
            }
            return playerApi.parseSubtitleToSentences({
                subtitlePath: activeDoc.srtFile,
                videoId: activeDoc.videoId,
                playbackSessionId: sessionId,
            });
        };

        void activateDocSubtitle()
            .then((parsed) => {
                if (cancelled) return;
                const parsedSentences = parsed?.sentences ?? [];
                setSentences(parsedSentences);

                const fileHash = parsed?.fileHash ?? parsedSentences[0]?.fileHash;
                if (fileHash) {
                    const resumeIdx = getSavedReaderProgress(activeDoc.videoId) ?? parsedSentences[0]?.index ?? 0;
                    requestReaderTranslation(fileHash, resumeIdx);
                }
                if (fileHash && typeof playerApi.matchSubtitleVocabulary === 'function') {
                    void playerApi
                        .matchSubtitleVocabulary({
                            fileHash,
                            videoId: activeDoc.videoId,
                            playbackSessionId: sessionId,
                        })
                        .then((match) => {
                            if (!cancelled && !match.cancelled && match.wordStates) {
                                useVocabularyStore.getState().setVocabularyStates(match.wordStates);
                            }
                        })
                        .catch(() => {
                            // 词汇匹配失败不影响阅读正文
                        });
                }

                if (parsedSentences.length >= 2 && typeof playerApi.getSceneBoundaries === 'function') {
                    const sceneInput: SceneSentence[] = parsedSentences.map((s) => ({
                        fileHash: s.fileHash,
                        index: s.index,
                        start: s.start,
                        end: s.end,
                        text: s.text,
                    }));
                    void playerApi
                        .getSceneBoundaries(sceneInput, activeDoc.videoPath || undefined)
                        .then((raw) => {
                            if (!cancelled) {
                                setSceneDividers(selectSceneDividers(raw));
                            }
                        })
                        .catch(() => {
                            // 场景分割属于增强导航，失败静默忽略
                        });
                }
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
    }, [activeDoc, requestReaderTranslation]);

    const filteredDocs = useMemo(() => {
        const q = docQuery.trim().toLowerCase();
        if (!q) return documents;
        return documents.filter((d) => d.title.toLowerCase().includes(q));
    }, [documents, docQuery]);

    const vocabularyCounts = useTranscriptVocabularyCounts(activeSentences);
    const countOf = useCallback(
        (sentence: Sentence) =>
            vocabularyCounts.get(sentenceVocabularyKey(sentence)) ?? EMPTY_SENTENCE_VOCABULARY_COUNT,
        [vocabularyCounts],
    );

    const searchActive = searchQuery.trim() !== '';
    const searchTranslations = useSubtitleTranslation((state) =>
        searchActive ? state.translations : EMPTY_TRANSLATIONS,
    );

    const displaySentences = useMemo(
        () => filterReaderSentences({
            sentences: activeSentences,
            filter,
            query: searchQuery,
            countOf,
            savedKeys,
            translations: searchTranslations,
        }),
        [activeSentences, filter, searchQuery, countOf, savedKeys, searchTranslations],
    );

    const blocks = useMemo(() => groupSentencesIntoBlocks(displaySentences), [displaySentences]);

    const dividerByIndex = useMemo(() => {
        const map = new Map<number, SceneBoundary>();
        for (const divider of sceneDividers) {
            map.set(divider.sentenceIndex, divider);
        }
        return map;
    }, [sceneDividers]);

    const vocabSummary = useMemo(
        () => collectReaderVocabularySummary(activeSentences, getWordStatus, 10),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [activeSentences, getWordStatus, vocabVersion],
    );

    const scrollToSentenceIndex = useCallback((sentenceIndex: number) => {
        if (viewMode === 'article') {
            const blockPos = blocks.findIndex((b) => b.sentences.some((s) => s.index === sentenceIndex));
            if (blockPos >= 0 && blocks.length > VIRTUALIZE_BLOCK_THRESHOLD) {
                blockVirtuosoRef.current?.scrollToIndex({
                    index: blockPos,
                    align: 'center',
                    behavior: 'smooth',
                });
                return;
            }
        } else {
            const listPos = displaySentences.findIndex((s) => s.index === sentenceIndex);
            if (listPos >= 0 && displaySentences.length > VIRTUALIZE_SENTENCE_THRESHOLD) {
                sentenceVirtuosoRef.current?.scrollToIndex({
                    index: listPos,
                    align: 'center',
                    behavior: 'smooth',
                });
                return;
            }
        }

        const el = plainScrollerRef.current?.querySelector(
            `[data-testid="script-sentence-row-${sentenceIndex}"]`,
        );
        if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
            (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }, [viewMode, blocks, displaySentences]);

    const handleSentenceFocus = useCallback((sentenceIndex: number) => {
        if (activeDoc) {
            saveReaderProgress(activeDoc.videoId, sentenceIndex);
        }
        const fileHash = activeSentences[0]?.fileHash;
        requestReaderTranslation(fileHash, sentenceIndex);
        scrollToSentenceIndex(sentenceIndex);
    }, [activeDoc, activeSentences, requestReaderTranslation, scrollToSentenceIndex]);

    const audioReader = useScriptAudioReader({
        videoId: activeDoc?.videoId,
        videoPath: activeDoc?.videoPath,
        sentences: displaySentences,
        onSentenceFocus: handleSentenceFocus,
    });

    // 文档首次加载完毕后优先定位 ?sentence= 深链句，否则恢复上次阅读焦点
    useEffect(() => {
        if (!activeDoc || loadingScript || activeSentences.length === 0) {
            return;
        }
        const parsedDeepLink =
            deepLinkSentenceRaw !== null && deepLinkSentenceRaw.trim() !== ''
                ? Number(deepLinkSentenceRaw)
                : NaN;
        const targetIndex =
            Number.isInteger(parsedDeepLink) &&
            parsedDeepLink >= 0 &&
            (!routeVideoId || routeVideoId === activeDoc.videoId) &&
            activeSentences.some((s) => s.index === parsedDeepLink)
                ? parsedDeepLink
                : getSavedReaderProgress(activeDoc.videoId);

        if (targetIndex !== null && targetIndex >= 0) {
            const exists = activeSentences.some((s) => s.index === targetIndex);
            if (exists) {
                audioReader.setActiveSentenceIndex(targetIndex);
                scrollToSentenceIndex(targetIndex);
            }
        }
        // 仅在文档内容加载完成时定位一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDoc?.videoId, loadingScript, deepLinkSentenceRaw]);

    // 空格键快捷控制伴读暂停/继续（输入焦点不在文本框或按钮内时生效）
    useEffect(() => {
        if (!activeDoc || displaySentences.length === 0) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' || target.isContentEditable)) {
                return;
            }
            event.preventDefault();
            audioReader.togglePlayPause();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeDoc, displaySentences.length, audioReader]);

    const activeSentence = useMemo(
        () => (
            audioReader.activeSentenceIndex !== null
                ? activeSentences.find((s) => s.index === audioReader.activeSentenceIndex) ?? null
                : null
        ),
        [activeSentences, audioReader.activeSentenceIndex],
    );

    const handleToggleTranslation = useCallback(() => {
        const next = !showTranslation;
        setShowTranslation(next);
        if (next) {
            const fileHash = activeSentences[0]?.fileHash;
            const targetIdx = audioReader.activeSentenceIndex ?? activeSentences[0]?.index ?? 0;
            if (fileHash) {
                const store = useSubtitleTranslation.getState();
                if (store.activeFileHash !== fileHash) {
                    store.setActiveFileHash(fileHash);
                }
                store.requestTranslation(fileHash, Math.max(0, targetIdx));
            }
        }
    }, [showTranslation, activeSentences, audioReader.activeSentenceIndex]);
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
                    if (!saved) {
                        setSavedByKey((prev) => {
                            const next = new Map(prev);
                            next.delete(sentenceKey);
                            return next;
                        });
                    }
                })
                .catch(() => {
                    toast.error(t('scriptReader.saveFailed', { defaultValue: '操作失败' }));
                });
        },
        [activeDoc, toggleSavedSentence, t],
    );

    const handleSaveNote = useCallback(
        async (sentence: Sentence, tag: SavedSentenceTag, note: string) => {
            if (!activeDoc) return;
            const sentenceKey = `${sentence.fileHash}:${sentence.index}`;
            try {
                if (!savedKeys.has(sentenceKey)) {
                    const created = await contextStudioApi.saveSentence({
                        sentenceKey,
                        videoId: activeDoc.videoId,
                        videoTitle: activeDoc.title,
                        fileHash: sentence.fileHash,
                        sentenceIndex: sentence.index,
                        startTime: sentence.adjustedStart ?? sentence.start,
                        endTime: sentence.adjustedEnd ?? sentence.end,
                        text: sentence.text,
                        textZh: sentence.textZH || '',
                        tag,
                        note,
                    });
                    await useSavedSentences.getState().loadForVideo(activeDoc.videoId);
                    setSavedByKey((prev) => new Map(prev).set(sentenceKey, created));
                } else if (typeof contextStudioApi.updateSavedSentence === 'function') {
                    const updated = await contextStudioApi.updateSavedSentence({
                        sentenceKey,
                        tag,
                        note,
                    });
                    if (updated) {
                        setSavedByKey((prev) => new Map(prev).set(sentenceKey, updated));
                    }
                }
                toast.success(t('scriptReader.noteSavedToast', { defaultValue: '笔记已保存' }));
            } catch {
                toast.error(t('scriptReader.saveFailed', { defaultValue: '操作失败' }));
            }
        },
        [activeDoc, savedKeys, t],
    );

    const handleJumpToPlayer = useCallback(
        (targetSentence: Sentence | null, withPractice = false) => {
            if (!activeDoc) return;
            const query = new URLSearchParams();
            if (targetSentence) {
                const tSec = Math.max(0, Math.floor(targetSentence.adjustedStart ?? targetSentence.start));
                if (tSec > 0) {
                    query.set('t', String(tSec));
                }
            }
            if (withPractice) {
                query.set('practice', 'shadowing');
            }
            const qs = query.toString();
            navigate(`/player/${activeDoc.videoId}${qs ? `?${qs}` : ''}`);
        },
        [activeDoc, navigate],
    );

    const handleJumpToSentenceFromNav = useCallback((sentenceIndex: number) => {
        if (filter !== 'all') {
            setFilter('all');
        }
        if (searchQuery) {
            setSearchQuery('');
        }
        audioReader.setActiveSentenceIndex(sentenceIndex);
        if (activeDoc) {
            saveReaderProgress(activeDoc.videoId, sentenceIndex);
        }
        setTimeout(() => scrollToSentenceIndex(sentenceIndex), 0);
    }, [filter, searchQuery, audioReader, activeDoc, scrollToSentenceIndex]);

    const handleRequestPop = useCallback((key: string) => {
        setPopEle((prev) => (prev === key ? prev : key));
    }, []);

    const handlePlaySentence = useCallback((target: Sentence) => {
        audioReader.playFromSentenceIndex(target.index);
    }, [audioReader]);

    const handleToggleNote = useCallback((sentenceKey: string) => {
        setOpenNoteKey((prev) => (prev === sentenceKey ? null : sentenceKey));
    }, []);

    const savedInDocCount = useMemo(() => {
        let count = 0;
        for (const s of activeSentences) {
            if (savedKeys.has(`${s.fileHash}:${s.index}`)) {
                count += 1;
            }
        }
        return count;
    }, [activeSentences, savedKeys]);

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-body">
            {/* 顶栏标题 */}
            <div className="px-6 pt-5 pb-2 shrink-0">
                <PageHeader
                    title={t('scriptReader.title', { defaultValue: '精读文稿' })}
                    description={t('scriptReader.description', {
                        defaultValue: '点词查义、连续伴读、难句笔记与场景定位',
                    })}
                />
            </div>

            {/* 双栏精读工作区 */}
            <div className="flex-1 min-h-0 px-6 pb-5 pt-2 overflow-hidden">
                <Card padding={0} height="100%" className="h-full min-h-0 flex overflow-hidden">
                    <ScriptDocSidebar
                        documents={filteredDocs}
                        loadingDocs={loadingDocs}
                        docQuery={docQuery}
                        onDocQueryChange={setDocQuery}
                        activeVideoId={activeDoc?.videoId}
                        playingVideoId={playingVideoId}
                        onSelectDoc={handleSelectDoc}
                    />

                    {/* 右栏：阅读画布 */}
                    <main className="flex-1 min-w-0 flex flex-col min-h-0 bg-body/60">
                        {activeDoc ? (
                            <>
                                <ScriptReaderToolbar
                                    title={activeDoc.title}
                                    totalSentences={activeSentences.length}
                                    savedCount={savedInDocCount}
                                    viewMode={viewMode}
                                    onChangeViewMode={setViewMode}
                                    filter={filter}
                                    onChangeFilter={setFilter}
                                    searchQuery={searchQuery}
                                    onChangeSearchQuery={setSearchQuery}
                                    matchCount={displaySentences.length}
                                    showTranslation={showTranslation}
                                    onToggleTranslation={handleToggleTranslation}
                                    onOpenInPlayer={() => handleJumpToPlayer(activeSentence, false)}
                                    vocabSummary={vocabSummary}
                                    sceneDividers={sceneDividers}
                                    onJumpToSentenceIndex={handleJumpToSentenceFromNav}
                                />

                                {/* 沉浸式交互正文排版区 */}
                                <div className="flex-1 min-h-0 flex flex-col">
                                    {loadingScript ? (
                                        <div className="py-12 text-center text-sm text-secondary">
                                            {t('scriptReader.loadingScript', { defaultValue: '加载文稿中...' })}
                                        </div>
                                    ) : activeSentences.length === 0 ? (
                                        <div className="py-12 text-center text-sm text-secondary">
                                            {t('scriptReader.emptyScript', { defaultValue: '暂无字幕内容' })}
                                        </div>
                                    ) : displaySentences.length === 0 ? (
                                        <div className="py-12 text-center text-sm text-secondary">
                                            {t('scriptReader.emptyFiltered', { defaultValue: '当前筛选或搜索条件没有匹配句子' })}
                                        </div>
                                    ) : viewMode === 'sentence' ? (
                                        displaySentences.length > VIRTUALIZE_SENTENCE_THRESHOLD ? (
                                            <Virtuoso<Sentence>
                                                ref={sentenceVirtuosoRef}
                                                className="flex-1 min-h-0"
                                                data={displaySentences}
                                                computeItemKey={(_, item) => `${item.fileHash}:${item.index}`}
                                                rangeChanged={({ startIndex }) => {
                                                    const target = displaySentences[startIndex];
                                                    if (target) {
                                                        requestReaderTranslation(target.fileHash, target.index);
                                                    }
                                                }}
                                                itemContent={(_, s) => {
                                                    const key = `${s.fileHash}:${s.index}`;
                                                    return (
                                                        <div className="px-8 py-1.5">
                                                            <ScriptSentenceRow
                                                                sentence={s}
                                                                isActive={audioReader.activeSentenceIndex === s.index}
                                                                isPlaying={audioReader.isPlaying}
                                                                isSaved={savedKeys.has(key)}
                                                                savedRecord={savedByKey.get(key)}
                                                                isNoteOpen={openNoteKey === key}
                                                                showTranslation={showTranslation}
                                                                searchQuery={searchQuery}
                                                                popEle={popEle}
                                                                sceneDivider={dividerByIndex.get(s.index)}
                                                                onRequestPop={handleRequestPop}
                                                                onPlaySentence={handlePlaySentence}
                                                                onPauseAudio={audioReader.stop}
                                                                onToggleSave={handleToggleSave}
                                                                onToggleNote={handleToggleNote}
                                                                onSaveNote={handleSaveNote}
                                                                onJumpToPlayer={handleJumpToPlayer}
                                                            />
                                                        </div>
                                                    );
                                                }}
                                            />
                                        ) : (
                                            <div ref={plainScrollerRef} className="flex-1 min-h-0 overflow-y-auto px-8 py-6 flex flex-col gap-3">
                                                {displaySentences.map((s) => {
                                                    const key = `${s.fileHash}:${s.index}`;
                                                    return (
                                                        <ScriptSentenceRow
                                                            key={key}
                                                            sentence={s}
                                                            isActive={audioReader.activeSentenceIndex === s.index}
                                                            isPlaying={audioReader.isPlaying}
                                                            isSaved={savedKeys.has(key)}
                                                            savedRecord={savedByKey.get(key)}
                                                            isNoteOpen={openNoteKey === key}
                                                            showTranslation={showTranslation}
                                                            searchQuery={searchQuery}
                                                            popEle={popEle}
                                                            sceneDivider={dividerByIndex.get(s.index)}
                                                            onRequestPop={handleRequestPop}
                                                            onPlaySentence={handlePlaySentence}
                                                            onPauseAudio={audioReader.stop}
                                                            onToggleSave={handleToggleSave}
                                                            onToggleNote={handleToggleNote}
                                                            onSaveNote={handleSaveNote}
                                                            onJumpToPlayer={handleJumpToPlayer}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )
                                    ) : blocks.length > VIRTUALIZE_BLOCK_THRESHOLD ? (
                                        <Virtuoso
                                            ref={blockVirtuosoRef}
                                            className="flex-1 min-h-0"
                                            data={blocks}
                                            computeItemKey={(idx, block) => `block-${block.sentences[0]?.index ?? idx}`}
                                            itemContent={(_, block) => (
                                                <div className="px-8 py-3">
                                                    <ScriptArticleBlock
                                                        block={block}
                                                        activeSentenceIndex={audioReader.activeSentenceIndex}
                                                        isPlaying={audioReader.isPlaying}
                                                        showTranslation={showTranslation}
                                                        searchQuery={searchQuery}
                                                        popEle={popEle}
                                                        savedKeys={savedKeys}
                                                        savedByKey={savedByKey}
                                                        openNoteKey={openNoteKey}
                                                        onRequestPop={handleRequestPop}
                                                        onPlaySentence={handlePlaySentence}
                                                        onPauseAudio={audioReader.stop}
                                                        onToggleSave={handleToggleSave}
                                                        onToggleNote={handleToggleNote}
                                                        onSaveNote={handleSaveNote}
                                                        onJumpToPlayer={handleJumpToPlayer}
                                                    />
                                                </div>
                                            )}
                                        />
                                    ) : (
                                        <div ref={plainScrollerRef} className="flex-1 min-h-0 overflow-y-auto px-8 py-6 flex flex-col gap-6">
                                            {blocks.map((block, idx) => (
                                                <ScriptArticleBlock
                                                    key={`block-${block.sentences[0]?.index ?? idx}`}
                                                    block={block}
                                                    activeSentenceIndex={audioReader.activeSentenceIndex}
                                                    isPlaying={audioReader.isPlaying}
                                                    showTranslation={showTranslation}
                                                    searchQuery={searchQuery}
                                                    popEle={popEle}
                                                    savedKeys={savedKeys}
                                                    savedByKey={savedByKey}
                                                    openNoteKey={openNoteKey}
                                                    onRequestPop={handleRequestPop}
                                                    onPlaySentence={handlePlaySentence}
                                                    onPauseAudio={audioReader.stop}
                                                    onToggleSave={handleToggleSave}
                                                    onToggleNote={handleToggleNote}
                                                    onSaveNote={handleSaveNote}
                                                    onJumpToPlayer={handleJumpToPlayer}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <ScriptAudioBar
                                    totalSentences={activeSentences.length}
                                    activeSentence={activeSentence}
                                    isPlaying={audioReader.isPlaying}
                                    autoAdvance={audioReader.autoAdvance}
                                    singleLoop={audioReader.singleLoop}
                                    playbackRate={audioReader.playbackRate}
                                    onTogglePlayPause={audioReader.togglePlayPause}
                                    onStepSentence={audioReader.stepSentence}
                                    onToggleAutoAdvance={() => audioReader.setAutoAdvance((v) => !v)}
                                    onToggleSingleLoop={() => audioReader.setSingleLoop((v) => !v)}
                                    onChangePlaybackRate={audioReader.setPlaybackRate}
                                    onJumpToPlayer={(withPractice) => handleJumpToPlayer(activeSentence, withPractice)}
                                />
                            </>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-3">
                                <BookOpenText className="h-8 w-8 text-secondary/60" />
                                <Text type="body" weight="medium">
                                    {t('scriptReader.emptySelectTitle', { defaultValue: '选择左侧文稿开始阅读' })}
                                </Text>
                                <Text type="supporting" color="secondary" className="max-w-sm">
                                    {t('scriptReader.emptySelectDesc', {
                                        defaultValue: '支持点词查义、连续伴读、句法笔记与带着进度跳回视频。',
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
