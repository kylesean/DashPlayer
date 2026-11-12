import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useShallow } from 'zustand/react/shallow';
import { twJoin } from 'tailwind-merge';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Badge } from '@astryxdesign/core/Badge';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import {
    DropdownMenu,
    DropdownMenuGroup,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from '@astryxdesign/core/DropdownMenu';
import { ArrowLeftRight, BookOpen, ChevronDown, ChevronUp, FileText, Filter, Languages, List, LocateFixed, PanelLeftClose, PanelRightClose, Repeat, Search, X } from 'lucide-react';
import SideSentence from '../SideSentence';
import ArticleBlock from './ArticleBlock';
import { groupSentencesIntoBlocks, type SentenceBlock } from '@/fronted/features/player/lib/sentence-grouping';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import useLayout from '@/fronted/app/stores/layoutStore';
import { cn } from '@/fronted/lib/utils';
import useSubtitleScroll, { useSubtitleScrollState } from '@/fronted/features/player/hooks/useSubtitleScroll';
import { useSideTranslationHold } from '@/fronted/features/player/hooks/useSideTranslationHold';
import {
    PLAYER_SIDEBAR_SCROLLER_TESTID,
    SENTENCE_CARD_TESTID,
    SIDE_TRANSLATION_TOGGLE_TESTID,
} from '@/common/constants/player-scroll-protocol';
import useBoundary from '@/fronted/features/player/hooks/useBoundary';
import useChatPanel from '@/fronted/features/chat/chatStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import useTranslation, { EMPTY_TRANSLATIONS } from '@/fronted/features/player/translationStore';
import { exitOverlayView } from '@/fronted/features/player/lib/player-view-controller';
import type { Sentence } from '@/common/types/SentenceC';
import { splitWords, isWordToken, cleanWord } from '@/common/utils/subtitle';
import { isContentLemma } from '@/common/learning/contentWords';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import {
    EMPTY_SENTENCE_VOCABULARY_COUNT,
    filterTranscriptSentences,
    sentenceVocabularyKey,
    useTranscriptVocabularyCounts,
    type TranscriptVocabularyFilter,
} from '@/fronted/features/player/transcriptVocabulary';

const VIRTUOSO_COMPONENTS = {
    Footer: () => <div className="h-28" />,
    Header: () => <div className="h-1" />,
};

export default function Subtitle() {
    const showSideBar = useLayout((state) => state.showSideBar);
    const showTranscript = useLayout((state) => state.showTranscript);
    const setTranscriptVisible = useLayout((state) => state.setTranscriptVisible);
    const transcriptViewMode = useLayout((state) => state.transcriptViewMode);
    const toggleTranscriptViewMode = useLayout((state) => state.toggleTranscriptViewMode);
    const transcriptPosition = (useSetting((s) => s.setting('appearance.transcriptPosition')) || 'right') as 'left' | 'right';
    const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));
    const showSideTranslation = usePlayerUi((state) => state.showSideTranslation);
    const changeShowSideTranslation = usePlayerUi((state) => state.changeShowSideTranslation);
    const { t } = useI18nTranslation('player');
    const { currentSentence, subtitle, singleRepeat, hoverRepeat, virtualGroup, srtTender } = usePlayerState(
        useShallow((s) => ({
            currentSentence: s.currentSentence,
            subtitle: s.sentences,
            singleRepeat: s.singleRepeat,
            hoverRepeat: s.hoverRepeat,
            virtualGroup: s.virtualGroup,
            // 时间轴微调只写进 tender 索引，不回写句子对象；
            // 逐行徽章必须问 tender，否则调完永远不出现。
            srtTender: s.srtTender,
        })),
    );
    const { setBoundaryRef } = useBoundary();

    /**
     * 上报一次整句重播：按句内实际词形记录，供后续「重听」学习信号使用。
     *
     * 只记录内容词，虚词重听通常不携带学习价值；失败只影响证据，不影响播放。
     */
    const recordReplay = useCallback((target: Sentence) => {
        const session = usePlaybackSession.getState();
        const sentenceHash = `${target.fileHash}:${target.index}`;
        const reported = new Set<string>();
        for (const token of splitWords(target.text)) {
            if (!isWordToken(token)) {
                continue;
            }
            const word = cleanWord(token);
            if (!word || reported.has(word) || !isContentLemma(word)) {
                continue;
            }
            reported.add(word);
            void videoLearningApi.recordWordEncounter({
                word,
                action: 'replay',
                videoId: session.videoId ?? undefined,
                fileHash: session.srtHash ?? undefined,
                sentenceIndex: target.index,
                sentenceHash,
                context: target.text,
            }).catch(() => {
                // 重播证据属于增强信号，写入失败不打断播放。
            });
        }
    }, []);

    const scrollerRef = useRef<HTMLElement | Window | null>(null);
    /** 卸载当前滚动容器上用户输入监听的函数；容器（重）挂载时先卸载旧监听 */
    const detachUserInputRef = useRef<(() => void) | null>(null);

    const {
        scrollState,
        onScrolling,
        updateCurrentRef,
        setVirtuoso,
        updateVisibleRange,
        delaySetNormal,
        syncIntoView,
    } = useSubtitleScrollState(
        useShallow((s) => ({
            scrollState: s.scrollState,
            onScrolling: s.onScrolling,
            updateCurrentRef: s.updateCurrentRef,
            setVirtuoso: s.setVirtuoso,
            updateVisibleRange: s.updateVisibleRange,
            delaySetNormal: s.delaySetNormal,
            syncIntoView: s.syncIntoView,
        })),
    );

    // 模式切换时重置同步记忆并恢复正常跟读状态
    useEffect(() => {
        useSubtitleScroll.getState().resetSyncDedupe();
        delaySetNormal();
    }, [transcriptViewMode, delaySetNormal]);

    // 「侧栏译文」切换后保持阅读位置：行高变化会让整个列表位移，这里把用户正在读的那一行钉回原处。
    // 具体策略（等布局稳定 → 逐轮逼近 → 收敛/放弃）在 useSideTranslationHold 里，
    // 不要在组件里另行写 scrollTop，否则又会和 Virtuoso 的分批重测抢位置。
    const getScroller = useCallback(() => {
        const scroller = scrollerRef.current;
        return scroller instanceof HTMLElement ? scroller : null;
    }, []);
    useSideTranslationHold(getScroller);

    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    /**
     * 用户显式导航过的匹配项（上下条/Enter）。
     * 记录它所属的搜索词：词未变时钉住选择，词变了则自动回落到「距当前播放位置最近」的匹配。
     */
    const [pinnedMatch, setPinnedMatch] = useState<{ query: string; index: number }>({ query: '', index: -1 });
    const searchInputRef = useRef<HTMLInputElement>(null);
    const virtuosoHandleRef = useRef<VirtuosoHandle | null>(null);
    const activeBlockRef = useRef<HTMLDivElement | null>(null);
    /**
     * 文稿词汇筛选。默认 `all`：筛选是用户主动进入的阅读模式，
     * 不能因为词表为空就把整篇文稿藏起来。
     */
    const [vocabularyFilter, setVocabularyFilter] = useState<TranscriptVocabularyFilter>('all');

    /** 整份文稿的词汇标记统计，一次算完供筛选与状态点共用。 */
    const vocabularyCounts = useTranscriptVocabularyCounts(subtitle);

    const countOf = useCallback(
        (sentence: Sentence) =>
            vocabularyCounts.get(sentenceVocabularyKey(sentence)) ?? EMPTY_SENTENCE_VOCABULARY_COUNT,
        [vocabularyCounts],
    );

    /**
     * 实际渲染的句子列表。
     *
     * 筛选时永远保留当前播放句：把正在播的那一句筛掉，用户会以为播放器坏了。
     * 其余所有「位置」概念（滚动定位、搜索匹配、拖拽选区）都必须基于这份列表，
     * 否则筛选后下标会错位到别的句子上。
     */
    const displaySentences = useMemo(
        () =>
            filterTranscriptSentences(
                subtitle,
                vocabularyFilter,
                countOf,
                (sentence) =>
                    !!currentSentence
                    && sentence.index === currentSentence.index
                    && sentence.fileHash === currentSentence.fileHash,
            ),
        [subtitle, vocabularyFilter, countOf, currentSentence],
    );

    const filterCounts = useMemo(() => {
        let learning = 0;
        let familiar = 0;
        for (const sentence of subtitle) {
            const count = countOf(sentence);
            if (count.learning > 0) learning += 1;
            if (count.familiar > 0) familiar += 1;
        }
        return { all: subtitle.length, learning, familiar };
    }, [subtitle, countOf]);

    const currentListPosition = useMemo(() => {
        if (!currentSentence || displaySentences.length === 0) {
            return -1;
        }
        return displaySentences.findIndex(
            (item) => item.index === currentSentence.index && item.fileHash === currentSentence.fileHash
        );
    }, [currentSentence, displaySentences]);

    // 字幕列表整体换掉（换视频/重新加载）时清掉「上次同步下标」的去重记忆：
    // 新列表里同一下标代表的是另一句，必须允许重新同步一次。
    useEffect(() => {
        useSubtitleScroll.getState().resetSyncDedupe();
    }, [displaySentences]);

    useEffect(() => {
        if (transcriptViewMode !== 'sentence' || currentListPosition < 0) {
            return;
        }
        syncIntoView(currentListPosition);
    }, [transcriptViewMode, currentListPosition, syncIntoView]);

    // 搜索进行中才订阅整张译文表（全文匹配需要）；未搜索时退化为稳定空引用，
    // 避免流式翻译的每一批译文到达都触发本组件与全部可见行重渲染。
    const searchActive = isSearchOpen && searchQuery.trim() !== '';
    const translations = useTranslation((state) =>
        searchActive ? state.translations : EMPTY_TRANSLATIONS,
    );

    const blocks = useMemo(() => groupSentencesIntoBlocks(displaySentences), [displaySentences]);

    const matchedSentenceIndices = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return [];
        const res: number[] = [];
        for (let i = 0; i < displaySentences.length; i++) {
            const s = displaySentences[i];
            const textMatch = s.text && s.text.toLowerCase().includes(q);
            const zhMatch = s.textZH && s.textZH.toLowerCase().includes(q);
            const dynamicZh = s.translationKey ? translations.get(s.translationKey) : '';
            const dynamicMatch = dynamicZh && dynamicZh.toLowerCase().includes(q);
            if (textMatch || zhMatch || dynamicMatch) {
                res.push(i);
            }
        }
        return res;
    }, [displaySentences, searchQuery, translations]);

    /** 未被显式导航时，默认选中距离当前播放位置最近的匹配项。 */
    const autoMatchIndex = useMemo(() => {
        if (matchedSentenceIndices.length === 0) return -1;
        const closest = matchedSentenceIndices.findIndex((idx) => idx >= currentListPosition);
        return closest >= 0 ? closest : 0;
    }, [matchedSentenceIndices, currentListPosition]);

    const safeMatchIndex = useMemo(() => {
        if (matchedSentenceIndices.length === 0) return -1;
        const pinned = pinnedMatch.query === searchQuery ? pinnedMatch.index : autoMatchIndex;
        if (pinned >= 0 && pinned < matchedSentenceIndices.length) {
            return pinned;
        }
        return 0;
    }, [pinnedMatch, searchQuery, autoMatchIndex, matchedSentenceIndices]);

    const activeMatchedSentenceIndex = useMemo(() => {
        if (safeMatchIndex >= 0 && safeMatchIndex < matchedSentenceIndices.length) {
            return displaySentences[matchedSentenceIndices[safeMatchIndex]]?.index ?? -1;
        }
        return -1;
    }, [safeMatchIndex, matchedSentenceIndices, displaySentences]);

    const currentBlockIndex = useMemo(() => {
        if (!currentSentence || blocks.length === 0) return -1;
        return blocks.findIndex((b) =>
            b.sentences.some((s) => s.index === currentSentence.index && s.fileHash === currentSentence.fileHash)
        );
    }, [currentSentence, blocks]);

    /**
     * article 模式的程序化滚动：先进入 AUTO_SCROLLING 再平滑滚动，
     * 归位 NORMAL 交给 handleArticleScroll 的「滚动事件静止」判定，
     * 避免动画进行中被误判为用户浏览。
     */
    const scrollArticleTo = useCallback((blockIdx: number) => {
        useSubtitleScroll.setState({ scrollState: 'AUTO_SCROLLING' });
        virtuosoHandleRef.current?.scrollToIndex({
            index: blockIdx,
            align: 'center',
            behavior: 'smooth',
        });
        useSubtitleScroll.getState().delaySetNormal();
    }, []);

    useEffect(() => {
        if (transcriptViewMode === 'article' && currentBlockIndex >= 0 && scrollState === 'NORMAL') {
            scrollArticleTo(currentBlockIndex);
        }
    }, [transcriptViewMode, currentBlockIndex, scrollState, scrollArticleTo]);

    const handleArticleScroll = useCallback(() => {
        const state = useSubtitleScroll.getState();
        if (state.scrollState === 'AUTO_SCROLLING') {
            // 程序滚动期间每个 scroll 事件都续期归位计时：滚动事件停止（平滑动画结束）才回 NORMAL。
            // 与 sentence 模式 onScrolling 的语义一致，避免动画中途被误判为用户浏览而闪现「回到当前句」。
            state.delaySetNormal();
            return;
        }
        const scroller = scrollerRef.current;
        if (!(scroller instanceof HTMLElement)) return;
        const currentRef = activeBlockRef.current;
        if (!currentRef) return;

        const scrollerRect = scroller.getBoundingClientRect();
        const eleRect = currentRef.getBoundingClientRect();

        // 舒适阅读区：上下至少保留 48px 安全余量
        const zoneTop = scrollerRect.top + 48;
        const zoneBottom = scrollerRect.bottom - 48;
        // 完全滑出视野
        const isOutOfView = eleRect.bottom <= scrollerRect.top + 16 || eleRect.top >= scrollerRect.bottom - 16;
        // 「成块」回到阅读区才恢复跟读：块主体（≥60% 高度）落在舒适区内且块中心也在区内。
        // 只要求边缘擦到区域的话，用户停在当前句块边缘露出 20px 也会被立即拉回原位，抢走阅读位置。
        const overlap = Math.min(eleRect.bottom, zoneBottom) - Math.max(eleRect.top, zoneTop);
        const visibleRatio = eleRect.height > 0 ? overlap / eleRect.height : 0;
        const blockCenter = eleRect.top + eleRect.height / 2;
        const isSettledInZone = visibleRatio >= 0.6 && blockCenter > zoneTop && blockCenter < zoneBottom;

        if (state.scrollState === 'NORMAL' && isOutOfView) {
            useSubtitleScroll.setState({ scrollState: 'USER_BROWSING' });
        } else if (state.scrollState === 'USER_BROWSING' && isSettledInZone) {
            state.delaySetNormal();
        }
    }, []);

    const scrollToMatch = useCallback((targetListIndex: number, shouldSeek = false) => {
        if (targetListIndex < 0 || targetListIndex >= displaySentences.length) return;
        const targetSentence = displaySentences[targetListIndex];
        if (!targetSentence) return;
        if (shouldSeek) {
            playerActions.gotoSentence(targetSentence);
        }
        if (transcriptViewMode === 'article') {
            const blockIdx = blocks.findIndex((b) =>
                b.sentences.some((s) => s.index === targetSentence.index && s.fileHash === targetSentence.fileHash)
            );
            if (blockIdx >= 0) {
                scrollArticleTo(blockIdx);
            }
        } else {
            virtuosoHandleRef.current?.scrollToIndex({
                index: targetListIndex,
                align: 'center',
                behavior: 'smooth',
            });
        }
    }, [displaySentences, transcriptViewMode, blocks, scrollArticleTo]);

    const handleSearchChange = (val: string) => {
        setSearchQuery(val);
    };

    /**
     * 搜索词变化时选中距离当前播放位置最近的匹配项并滚动过去。
     * 匹配扫描只由 matchedSentenceIndices 这一份 memo 负责（此前在这里重复扫一遍）；
     * 同一搜索词下 matchedSentenceIndices 因译文到达等再变化时保持用户当前导航位置，不重置选中。
     */
    const lastSearchQueryRef = useRef('');
    useEffect(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q || q === lastSearchQueryRef.current) {
            return;
        }
        lastSearchQueryRef.current = q;
        if (matchedSentenceIndices.length === 0 || safeMatchIndex < 0) {
            return;
        }
        // 仅滚动定位（副作用），选中项由 autoMatchIndex/safeMatchIndex 派生，无需在此 setState
        scrollToMatch(matchedSentenceIndices[safeMatchIndex], false);
    }, [searchQuery, matchedSentenceIndices, safeMatchIndex, scrollToMatch]);

    const handleNextMatch = useCallback(() => {
        if (matchedSentenceIndices.length === 0) return;
        const current = safeMatchIndex >= 0 ? safeMatchIndex : 0;
        const nextIdx = (current + 1) % matchedSentenceIndices.length;
        setPinnedMatch({ query: searchQuery, index: nextIdx });
        scrollToMatch(matchedSentenceIndices[nextIdx], true);
    }, [matchedSentenceIndices, safeMatchIndex, searchQuery, scrollToMatch]);

    const handlePrevMatch = useCallback(() => {
        if (matchedSentenceIndices.length === 0) return;
        const current = safeMatchIndex >= 0 ? safeMatchIndex : 0;
        const prevIdx = (current - 1 + matchedSentenceIndices.length) % matchedSentenceIndices.length;
        setPinnedMatch({ query: searchQuery, index: prevIdx });
        scrollToMatch(matchedSentenceIndices[prevIdx], true);
    }, [matchedSentenceIndices, safeMatchIndex, searchQuery, scrollToMatch]);

    const handleCloseSearch = () => {
        setIsSearchOpen(false);
        setSearchQuery('');
        setPinnedMatch({ query: '', index: -1 });
    };

    /** 搜索栏挂载后聚焦并全选：由 isSearchOpen 驱动，替代散落的 setTimeout 魔法延迟。 */
    useEffect(() => {
        if (isSearchOpen) {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
        }
    }, [isSearchOpen]);

    const toggleSearch = () => {
        if (isSearchOpen) {
            handleCloseSearch();
        } else {
            setIsSearchOpen(true);
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
                if (!showTranscript) return;
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) {
                    if (active !== searchInputRef.current) {
                        return;
                    }
                }
                e.preventDefault();
                setIsSearchOpen(true);
            } else if (e.key === 'Escape' && isSearchOpen) {
                e.preventDefault();
                e.stopPropagation();
                handleCloseSearch();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showTranscript, isSearchOpen]);

    useEffect(() => {
        return () => {
            detachUserInputRef.current?.();
            detachUserInputRef.current = null;
        };
    }, []);
    const dragStateRef = useRef<{
        active: boolean;
        startListPosition: number | null;
        lastListPosition: number | null;
        sentence: Sentence | null;
    }>({
        active: false,
        startListPosition: null,
        lastListPosition: null,
        sentence: null,
    });

    const selectionRangeRef = useRef<{ startPos: number; endPos: number } | null>(null);

    const virtualGroupMeta = useMemo(() => {
        if (!virtualGroup.active || virtualGroup.sentences.length < 2) {
            return {
                hasGroup: false,
                keyGroupSet: new Set<string>(),
                firstKey: null as string | null,
                lastKey: null as string | null,
            };
        }

        const keyGroupSet = new Set(virtualGroup.sentences.map((s) => `${s.fileHash}-${s.index}`));
        const first = virtualGroup.sentences[0];
        const last = virtualGroup.sentences[virtualGroup.sentences.length - 1];
        return {
            hasGroup: true,
            keyGroupSet,
            firstKey: first ? `${first.fileHash}-${first.index}` : null,
            lastKey: last ? `${last.fileHash}-${last.index}` : null,
        };
    }, [virtualGroup]);

    const applySelectionRange = useCallback((startPos: number, endPos: number) => {
        const normalizedStart = Math.min(startPos, endPos);
        const normalizedEnd = Math.max(startPos, endPos);

        if (selectionRangeRef.current &&
            selectionRangeRef.current.startPos === normalizedStart &&
            selectionRangeRef.current.endPos === normalizedEnd) {
            return;
        }

        if (normalizedEnd !== normalizedStart) {
            selectionRangeRef.current = { startPos: normalizedStart, endPos: normalizedEnd };
            const selectedSentences = displaySentences.slice(normalizedStart, normalizedEnd + 1);
            playerActions.setVirtualGroupBySentences(selectedSentences);
        } else {
            selectionRangeRef.current = null;
            playerActions.clearVirtualGroup();
        }
    }, [displaySentences]);

    const finalizeSelection = useCallback(() => {
        const state = dragStateRef.current;
        if (!state.active) {
            return;
        }

        state.active = false;
        const { startListPosition, lastListPosition, sentence } = state;

        if (
            startListPosition !== null &&
            lastListPosition !== null &&
            Math.abs(lastListPosition - startListPosition) >= 1
        ) {
            applySelectionRange(startListPosition, lastListPosition);
        } else if (sentence) {
            playerActions.clearVirtualGroup();
            // 学习页打开期间点击字幕视为正常跳转：先关闭学习页，再按常规跳转到该句
            if (useChatPanel.getState().learningVisible) {
                // 走统一退出入口：音频文件原来在播客模式，必须回到播客而不是空白舞台。
                exitOverlayView();
            }
            playerActions.gotoSentence(sentence);
            if (scrollState === 'USER_BROWSING') {
                delaySetNormal();
            }
        }

        selectionRangeRef.current = null;
        dragStateRef.current = {
            active: false,
            startListPosition: null,
            lastListPosition: null,
            sentence: null,
        };
    }, [applySelectionRange, delaySetNormal, scrollState]);

    useEffect(() => {
        window.addEventListener('mouseup', finalizeSelection);
        return () => {
            window.removeEventListener('mouseup', finalizeSelection);
        };
    }, [finalizeSelection]);

    const handleMouseDown = useCallback((sentence: Sentence, listPosition: number) => (event: React.MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-word="true"]') || target?.closest('button')) {
            // 点击或操作单词/按钮时不拦截原生交互与词典浮层
            return;
        }
        event.preventDefault();
        dragStateRef.current = {
            active: true,
            startListPosition: listPosition,
            lastListPosition: listPosition,
            sentence,
        };
        selectionRangeRef.current = null;
    }, []);

    const handleMouseEnter = useCallback((_sentence: Sentence, listPosition: number) => () => {
        const state = dragStateRef.current;
        if (!state.active || state.startListPosition === null) {
            return;
        }

        state.lastListPosition = listPosition;
        applySelectionRange(state.startListPosition, listPosition);
    }, [applySelectionRange]);

    const handleMouseUp = useCallback(() => {
        finalizeSelection();
    }, [finalizeSelection]);

    /**
     * Virtuoso 滚动容器（重）挂载时挂载/卸载用户输入监听。
     * 滚轮、滚动条拖拽、翻页键发生在自动滚动（AUTO_SCROLLING）期间时立即中断跟读，
     * 避免平滑动画与用户输入争夺滚动位置；其他状态下 onUserInterrupt 自身为空操作。
     */
    const handleScrollerRef = useCallback((ref: unknown) => {
        detachUserInputRef.current?.();
        detachUserInputRef.current = null;
        const scroller = ref as HTMLElement | null;
        scrollerRef.current = scroller;
        if (!scroller) {
            return;
        }
        // 稳定标识：滚动容器是自动化用例进入滚动世界的唯一入口
        scroller.setAttribute('data-testid', PLAYER_SIDEBAR_SCROLLER_TESTID);
        const interruptAutoScroll = () => {
            useSubtitleScroll.getState().onUserInterrupt();
        };
        const handlePointerDown = (e: PointerEvent) => {
            // 事件 target 为滚动容器本身说明按下的是滚动条区域，而非字幕行
            if (e.target === scroller) {
                interruptAutoScroll();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                interruptAutoScroll();
            }
        };
        scroller.addEventListener('wheel', interruptAutoScroll, { passive: true });
        scroller.addEventListener('pointerdown', handlePointerDown);
        scroller.addEventListener('keydown', handleKeyDown);
        detachUserInputRef.current = () => {
            scroller.removeEventListener('wheel', interruptAutoScroll);
            scroller.removeEventListener('pointerdown', handlePointerDown);
            scroller.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const handleRangeChanged = useCallback(({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
        updateVisibleRange([startIndex, endIndex]);
    }, [updateVisibleRange]);

    const renderItem = useCallback((listPosition: number, item: Sentence) => {
        const isCurrent = !!currentSentence && item.index === currentSentence.index && item.fileHash === currentSentence.fileHash;
        const itemKey = `${item.fileHash}-${item.index}`;
        const isSelected =
            virtualGroupMeta.hasGroup &&
            virtualGroupMeta.keyGroupSet.has(itemKey);
        const isGroupStart = isSelected && itemKey === virtualGroupMeta.firstKey;
        const isGroupEnd = isSelected && itemKey === virtualGroupMeta.lastKey;
        return (
            // 拖拽选区容器：鼠标按下/进入/抬起用于区间选择，不承担点击交互
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
                onMouseDown={handleMouseDown(item, listPosition)}
                onMouseEnter={handleMouseEnter(item, listPosition)}
                onMouseUp={handleMouseUp}
                data-testid={SENTENCE_CARD_TESTID}
                data-index={item.index}
                data-current={isCurrent ? 'true' : 'false'}
            >
                <SideSentence
                    sentence={item}
                    vocabularyCount={countOf(item)}
                    isTimeAdjusted={srtTender?.adjusted(item) ?? false}
                    onResetTime={(target) => { void playerActions.clearAdjust(target); }}
                    onClick={(targetSentence) => {
                        playerActions.clearVirtualGroup();
                        if (useChatPanel.getState().learningVisible) {
                            exitOverlayView();
                        }
                        playerActions.gotoSentence(targetSentence || item);
                        if (scrollState === 'USER_BROWSING') {
                            delaySetNormal();
                        }
                    }}
                    onReplay={(targetSentence) => {
                        recordReplay(targetSentence || item);
                        playerActions.clearVirtualGroup();
                        if (useChatPanel.getState().learningVisible) {
                            exitOverlayView();
                        }
                        playerActions.gotoSentence(targetSentence || item);
                        if (scrollState === 'USER_BROWSING') {
                            delaySetNormal();
                        }
                    }}
                    isCurrent={isCurrent}
                    isRepeat={singleRepeat || hoverRepeat}
                    searchQuery={searchQuery}
                    isActiveSearchMatch={activeMatchedSentenceIndex === item.index}
                    onToggleSingleRepeat={(sentence) => {
                        if (currentSentence && sentence.index === currentSentence.index && sentence.fileHash === currentSentence.fileHash) {
                            playerActions.setSingleRepeat(!singleRepeat);
                        } else {
                            playerActions.gotoSentence(sentence);
                            playerActions.setSingleRepeat(true);
                        }
                    }}
                    selectionState={
                        isSelected
                            ? {
                                isMember: true,
                                isGroupStart,
                                isGroupEnd,
                            }
                            : undefined
                    }
                    ref={(ref) => {
                        if (isCurrent) {
                            updateCurrentRef(ref, listPosition);
                        }
                    }}
                />
            </div>
        );
    }, [
        currentSentence,
        handleMouseDown,
        handleMouseEnter,
        handleMouseUp,
        singleRepeat,
        hoverRepeat,
        updateCurrentRef,
        virtualGroupMeta,
        searchQuery,
        activeMatchedSentenceIndex,
        scrollState,
        delaySetNormal,
        srtTender,
        recordReplay,
        countOf,
    ]);

    return (
        <div className="w-full h-full flex flex-col relative select-none" ref={setBoundaryRef}>
            {/* 字幕文稿流状态栏 */}
            <div className="shrink-0 px-3.5 py-2.5 flex items-center justify-between border-b border-border/40 bg-surface/50 backdrop-blur-md z-10 text-sm">
                <div className="flex items-center gap-2 min-w-0 shrink-0">
                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground tracking-tight">{t('subtitleScript')}</span>
                    {virtualGroup.active && virtualGroup.sentences.length > 1 && (
                        <div className="flex items-center gap-1">
                            <Badge
                                variant="teal"
                                icon={<Repeat className="w-2.5 h-2.5" />}
                                label={t('nSentencesLoop', { count: virtualGroup.sentences.length, defaultValue: `${virtualGroup.sentences.length} 句循环` })}
                            />
                            <Tooltip content={t('cancelLoop')} placement="below">
                                <button
                                    type="button"
                                    onClick={() => playerActions.clearVirtualGroup()}
                                    className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                                    aria-label={t('cancelLoop')}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </Tooltip>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/*
                      词汇筛选：只在文稿提供。主字幕是观看层，多一个筛选器就多一层噪音；
                      文稿是阅读层，用户需要「只看我还在学的词出现在哪些句子」。
                    */}
                    {/*
                      互斥筛选用 compound 模式的 DropdownMenuRadioGroup：它给的是
                      role="menuitemradio"，读屏会播报「三选一」，方向键也能在选项间移动。
                      用 action item 加一个勾选图标只能表达「看起来选中了」，语义是假的。
                    */}
                    <DropdownMenu
                        button={{
                            label: t('transcriptVocabulary.filterLabel', { defaultValue: '筛选' }),
                            icon: <Filter className="w-3.5 h-3.5" />,
                            size: 'sm',
                            variant: 'ghost',
                            isIconOnly: true,
                            tooltip: t('transcriptVocabulary.filterTooltip', { defaultValue: '按词汇状态筛选文稿' }),
                        }}
                        hasChevron={false}
                        placement="below"
                        alignment="end"
                    >
                        <DropdownMenuGroup title={t('transcriptVocabulary.filterTitle', { defaultValue: '只看' })}>
                            <DropdownMenuRadioGroup
                                value={vocabularyFilter}
                                onChange={(next) => setVocabularyFilter(next as TranscriptVocabularyFilter)}
                                label={t('transcriptVocabulary.filterTitle', { defaultValue: '只看' })}
                            >
                                <DropdownMenuRadioItem
                                    value="all"
                                    label={t('transcriptVocabulary.filterAll', { defaultValue: '全部句子' })}
                                    endContent={filterCounts.all}
                                />
                                <DropdownMenuRadioItem
                                    value="learning"
                                    label={t('transcriptVocabulary.filterLearning', { defaultValue: '含待学词' })}
                                    endContent={filterCounts.learning}
                                />
                                <DropdownMenuRadioItem
                                    value="familiar"
                                    label={t('transcriptVocabulary.filterFamiliar', { defaultValue: '含有印象的词' })}
                                    endContent={filterCounts.familiar}
                                />
                            </DropdownMenuRadioGroup>
                        </DropdownMenuGroup>
                    </DropdownMenu>

                    {/* 搜索开关 */}
                    <Tooltip content={t('searchTranscript', { defaultValue: '搜索文稿 (Cmd/Ctrl+F)' })} placement="below">
                        <button
                            type="button"
                            onClick={toggleSearch}
                            className={cn(
                                'p-1 rounded-md transition-colors cursor-pointer',
                                isSearchOpen
                                    ? 'text-accent bg-accent-muted/20'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                            )}
                            aria-label={t('searchTranscript', { defaultValue: '搜索文稿 (Cmd/Ctrl+F)' })}
                        >
                            <Search className="w-3.5 h-3.5" />
                        </button>
                    </Tooltip>

                    {/* 双模视图切换：单句精析模式 vs 连贯讲稿模式 */}
                    <Tooltip
                        content={
                            transcriptViewMode === 'sentence'
                                ? t('switchToArticleMode', { defaultValue: '切换为连贯讲稿模式' })
                                : t('switchToSentenceMode', { defaultValue: '切换为单句精析模式' })
                        }
                        placement="below"
                    >
                        <button
                            type="button"
                            onClick={() => toggleTranscriptViewMode()}
                            className={cn(
                                'p-1 rounded-md transition-colors cursor-pointer',
                                transcriptViewMode === 'article'
                                    ? 'text-accent bg-accent-muted/20'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                            )}
                            aria-label={
                                transcriptViewMode === 'sentence'
                                    ? t('switchToArticleMode', { defaultValue: '切换为连贯讲稿模式' })
                                    : t('switchToSentenceMode', { defaultValue: '切换为单句精析模式' })
                            }
                        >
                            {transcriptViewMode === 'sentence' ? (
                                <FileText className="w-3.5 h-3.5" />
                            ) : (
                                <List className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </Tooltip>

                    {/* 侧栏译文开关 */}
                    <Tooltip content={t('controlBox.sideTranslationHint')} placement="below">
                        <button
                            type="button"
                            data-testid={SIDE_TRANSLATION_TOGGLE_TESTID}
                            aria-pressed={showSideTranslation}
                            aria-label={t('controlBox.showSideTranslation')}
                            onClick={() => changeShowSideTranslation()}
                            className={cn(
                                'p-1 rounded-md transition-colors cursor-pointer',
                                showSideTranslation
                                    ? 'text-accent hover:bg-accent-muted/20'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                            )}
                        >
                            <Languages className="w-3.5 h-3.5" />
                        </button>
                    </Tooltip>

                    {/* 浏览偏离时回到当前播放句 */}
                    {scrollState === 'USER_BROWSING' && (currentListPosition >= 0 || currentBlockIndex >= 0) && (
                        <Tooltip content={t('controlButton.backToPlayhead')} placement="below">
                            <button
                                type="button"
                                onClick={() => {
                                    if (transcriptViewMode === 'article' && currentBlockIndex >= 0) {
                                        virtuosoHandleRef.current?.scrollToIndex({
                                            index: currentBlockIndex,
                                            align: 'center',
                                            behavior: 'smooth',
                                        });
                                        delaySetNormal();
                                    } else if (currentListPosition >= 0) {
                                        syncIntoView(currentListPosition);
                                    }
                                }}
                                className="p-1 rounded-md text-accent hover:bg-accent-muted/20 transition-colors cursor-pointer"
                                aria-label={t('controlButton.backToPlayhead')}
                            >
                                <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
                            </button>
                        </Tooltip>
                    )}

                    {/* 左右停靠对调切换 */}
                    <Tooltip
                        content={transcriptPosition === 'right' ? t('dockToLeft', { defaultValue: '将文稿切换至左侧' }) : t('dockToRight', { defaultValue: '将文稿切换至右侧' })}
                        placement="below"
                    >
                        <button
                            type="button"
                            onClick={() => {
                                const next = transcriptPosition === 'right' ? 'left' : 'right';
                                void useSetting.getState().setSetting('appearance.transcriptPosition', next);
                            }}
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                            aria-label={transcriptPosition === 'right' ? t('dockToLeft', { defaultValue: '将文稿切换至左侧' }) : t('dockToRight', { defaultValue: '将文稿切换至右侧' })}
                        >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                        </button>
                    </Tooltip>

                    {/* 收起字幕文稿 */}
                    <Tooltip content={t('controlButton.closeTranscript', { defaultValue: '收起字幕文稿' })} placement="below">
                        <button
                            type="button"
                            onClick={() => setTranscriptVisible(false)}
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                            aria-label={t('controlButton.closeTranscript', { defaultValue: '收起字幕文稿' })}
                        >
                            {transcriptPosition === 'right' ? (
                                <PanelRightClose className="w-3.5 h-3.5" />
                            ) : (
                                <PanelLeftClose className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* 即时搜索栏 */}
            {isSearchOpen && (
                <div className="shrink-0 px-3 py-1.5 border-b border-border/40 bg-surface/80 backdrop-blur-md flex items-center gap-2 text-sm z-20">
                    <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (e.shiftKey) {
                                    handlePrevMatch();
                                } else {
                                    handleNextMatch();
                                }
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                handlePrevMatch();
                            } else if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                handleNextMatch();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleCloseSearch();
                            }
                        }}
                        placeholder={t('searchPlaceholder', { defaultValue: '在文稿中搜索中英文...' })}
                        className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/60 text-sm min-w-0"
                    />
                    {searchQuery.trim() && (
                        <span className="text-metadata font-mono text-muted-foreground shrink-0 select-none">
                            {matchedSentenceIndices.length > 0 && safeMatchIndex >= 0 ? (
                                `${safeMatchIndex + 1}/${matchedSentenceIndices.length}`
                            ) : (
                                <span className="text-muted-foreground/60">{t('noSearchResults', { defaultValue: '无匹配' })}</span>
                            )}
                        </span>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0">
                        <Tooltip content={t('prevMatch', { defaultValue: '上一个匹配 (Shift+Enter)' })} placement="below">
                            {/* 用 aria-disabled 而不是原生 disabled：原生 disabled 会吞掉 hover 与焦点，
                                提示恰好在这一刻不可达。点击里自行拦截，行为保持一致。 */}
                            <button
                                type="button"
                                aria-disabled={matchedSentenceIndices.length === 0}
                                onClick={() => {
                                    if (matchedSentenceIndices.length === 0) return;
                                    handlePrevMatch();
                                }}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 aria-disabled:opacity-30 aria-disabled:cursor-not-allowed transition-colors cursor-pointer"
                                aria-label={t('prevMatch', { defaultValue: '上一个匹配 (Shift+Enter)' })}
                            >
                                <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                        </Tooltip>
                        <Tooltip content={t('nextMatch', { defaultValue: '下一个匹配 (Enter)' })} placement="below">
                            {/* 用 aria-disabled 而不是原生 disabled：原生 disabled 会吞掉 hover 与焦点，
                                提示恰好在这一刻不可达。点击里自行拦截，行为保持一致。 */}
                            <button
                                type="button"
                                aria-disabled={matchedSentenceIndices.length === 0}
                                onClick={() => {
                                    if (matchedSentenceIndices.length === 0) return;
                                    handleNextMatch();
                                }}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 aria-disabled:opacity-30 aria-disabled:cursor-not-allowed transition-colors cursor-pointer"
                                aria-label={t('nextMatch', { defaultValue: '下一个匹配 (Enter)' })}
                            >
                                <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                        </Tooltip>
                        <Tooltip content={t('closeSearch', { defaultValue: '关闭搜索 (Esc)' })} placement="below">
                            <button
                                type="button"
                                onClick={handleCloseSearch}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                                aria-label={t('closeSearch', { defaultValue: '关闭搜索 (Esc)' })}
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            )}

            {/*
              筛选生效时给出可撤销的状态条：文稿突然变短却没有解释，用户会以为
              字幕丢了。条上直接写明筛掉了多少句，并保留一键回到全部。
            */}
            {vocabularyFilter !== 'all' && (
                <div
                    className="shrink-0 px-3 py-1.5 border-b border-border/40 bg-accent-muted/10 flex items-center justify-between gap-2 text-metadata"
                    data-testid="transcript-vocabulary-filter-active"
                >
                    <span className="text-muted-foreground truncate">
                        {t('transcriptVocabulary.filteringHint', {
                            shown: displaySentences.length,
                            total: subtitle.length,
                            defaultValue: '只显示 {{shown}} / {{total}} 句',
                        })}
                    </span>
                    <button
                        type="button"
                        onClick={() => setVocabularyFilter('all')}
                        className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-accent-muted/20 transition-colors cursor-pointer"
                    >
                        {t('transcriptVocabulary.clearFilter', { defaultValue: '显示全部' })}
                    </button>
                </div>
            )}

            <div className="flex-1 min-h-0 relative">
                {displaySentences.length === 0 && vocabularyFilter !== 'all' ? (
                    <div className="h-full w-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                        <p className="text-sm text-muted-foreground">
                            {t('transcriptVocabulary.emptyTitle', { defaultValue: '这段里没有符合筛选的句子' })}
                        </p>
                        <button
                            type="button"
                            onClick={() => setVocabularyFilter('all')}
                            className="text-sm text-accent hover:underline cursor-pointer"
                        >
                            {t('transcriptVocabulary.clearFilter', { defaultValue: '显示全部' })}
                        </button>
                    </div>
                ) : transcriptViewMode === 'article' ? (
                    <Virtuoso<SentenceBlock>
                        onScroll={handleArticleScroll}
                        scrollerRef={handleScrollerRef}
                        increaseViewportBy={200}
                        minOverscanItemCount={{ top: 2, bottom: 4 }}
                        defaultItemHeight={120}
                        ref={(handle) => {
                            virtuosoHandleRef.current = handle;
                            if (handle) {
                                setVirtuoso(handle);
                            }
                        }}
                        className={twJoin(
                            'h-full w-full overflow-y-auto text-primary py-2',
                            'scrollbar-thin scrollbar-thumb-rounded-full',
                            showSideBar && 'scrollbar-none',
                        )}
                        data={blocks}
                        itemContent={(_index, block) => {
                            const hasActiveCurrent = block.sentences.some(
                                (s) => !!currentSentence && s.index === currentSentence.index && s.fileHash === currentSentence.fileHash,
                            );
                            return (
                                <ArticleBlock
                                    ref={hasActiveCurrent ? activeBlockRef : undefined}
                                    key={`block-${block.repr.fileHash}-${block.repr.index}`}
                                    block={block}
                                    currentSentence={currentSentence}
                                    searchQuery={searchQuery}
                                    activeMatchedSentenceIndex={activeMatchedSentenceIndex}
                                    showSideTranslation={showSideTranslation}
                                    fontSize={fontSize}
                                    onSentenceClick={(sentence) => {
                                        playerActions.clearVirtualGroup();
                                        if (useChatPanel.getState().learningVisible) {
                                            exitOverlayView();
                                        }
                                        playerActions.gotoSentence(sentence);
                                        if (scrollState === 'USER_BROWSING') {
                                            delaySetNormal();
                                        }
                                    }}
                                    onToggleSingleRepeat={(sentence) => {
                                        if (currentSentence && sentence.index === currentSentence.index && sentence.fileHash === currentSentence.fileHash) {
                                            playerActions.setSingleRepeat(!singleRepeat);
                                        } else {
                                            playerActions.gotoSentence(sentence);
                                            playerActions.setSingleRepeat(true);
                                        }
                                    }}
                                    isRepeat={singleRepeat || hoverRepeat}
                                />
                            );
                        }}
                        components={VIRTUOSO_COMPONENTS}
                    />
                ) : (
                    <Virtuoso<Sentence>
                        onScroll={onScrolling}
                        scrollerRef={handleScrollerRef}
                        increaseViewportBy={200}
                        minOverscanItemCount={{ top: 3, bottom: 6 }}
                        defaultItemHeight={60}
                        ref={(handle) => {
                            virtuosoHandleRef.current = handle;
                            if (handle) {
                                setVirtuoso(handle);
                            }
                        }}
                        className={twJoin(
                            'h-full w-full overflow-y-auto text-primary py-2',
                            'scrollbar-thin scrollbar-thumb-rounded-full',
                            showSideBar && 'scrollbar-none',
                        )}
                        data={displaySentences}
                        rangeChanged={handleRangeChanged}
                        itemContent={renderItem}
                        components={VIRTUOSO_COMPONENTS}
                    />
                )}
            </div>
        </div>
    );
}
