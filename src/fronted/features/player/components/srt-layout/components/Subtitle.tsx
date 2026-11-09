import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useShallow } from 'zustand/react/shallow';
import { twJoin } from 'tailwind-merge';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Badge } from '@astryxdesign/core/Badge';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { LocateFixed, Repeat, X } from 'lucide-react';
import SideSentence from '../SideSentence';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayerUi } from '@/fronted/features/player/playerUiStore';
import { isSidebarHiddenByEnglish } from '@/fronted/features/player/components/sidePanelVisibility';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import useLayout from '@/fronted/app/stores/layoutStore';
import { cn } from '@/fronted/lib/utils';
import useSubtitleScroll, { useSubtitleScrollState } from '@/fronted/features/player/hooks/useSubtitleScroll';
import { useSideTranslationHold } from '@/fronted/features/player/hooks/useSideTranslationHold';
import { PLAYER_SIDEBAR_SCROLLER_TESTID } from '@/fronted/features/player/dev/scrollWriteLog';
import useBoundary from '@/fronted/features/player/hooks/useBoundary';
import useChatPanel from '@/fronted/features/chat/chatStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import type { Sentence } from '@/common/types/SentenceC';

export default function Subtitle() {
    const showSideBar = useLayout((state) => state.showSideBar);
    const showEn = usePlayerUi((state) => state.showEn);
    const syncSide = usePlayerUi((state) => state.syncSide);
    const showSideTranslation = usePlayerUi((state) => state.showSideTranslation);
    const changeShowSideTranslation = usePlayerUi((state) => state.changeShowSideTranslation);
    const { t } = useI18nTranslation('player');
    // 「随英文字幕隐藏」把侧栏收起时，卡片文案是 opacity-0，chip 是这块空白唯一的解释
    const sidebarHiddenByEnglish = isSidebarHiddenByEnglish(syncSide, showEn);
    const toggleEnglishShortcut = useSetting(
        (state) => state.values.get('shortcut.toggleEnglishDisplay') ?? 'e',
    );
    const { currentSentence, subtitle, singleRepeat, hoverRepeat, virtualGroup } = usePlayerState(
        useShallow((s) => ({
            currentSentence: s.currentSentence,
            subtitle: s.sentences,
            singleRepeat: s.singleRepeat,
            hoverRepeat: s.hoverRepeat,
            virtualGroup: s.virtualGroup,
        })),
    );
    const { setBoundaryRef } = useBoundary();

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

    const currentListPosition = useMemo(() => {
        if (!currentSentence || subtitle.length === 0) {
            return -1;
        }
        return subtitle.findIndex(
            (item) => item.index === currentSentence.index && item.fileHash === currentSentence.fileHash
        );
    }, [currentSentence, subtitle]);

    useEffect(() => {
        if (currentListPosition < 0) {
            return;
        }
        syncIntoView(currentListPosition);
    }, [currentListPosition, syncIntoView]);

    // 字幕列表整体换掉（换视频/重新加载）时清掉「上次同步下标」的去重记忆：
    // 新列表里同一下标代表的是另一句，必须允许重新同步一次。
    useEffect(() => {
        useSubtitleScroll.getState().resetSyncDedupe();
    }, [subtitle]);

    // 「侧栏译文」切换后保持阅读位置：行高变化会让整个列表位移，这里把用户正在读的那一行钉回原处。
    // 具体策略（等布局稳定 → 逐轮逼近 → 收敛/放弃）在 useSideTranslationHold 里，
    // 不要在组件里另行写 scrollTop，否则又会和 Virtuoso 的分批重测抢位置。
    const getScroller = useCallback(() => {
        const scroller = scrollerRef.current;
        return scroller instanceof HTMLElement ? scroller : null;
    }, []);
    useSideTranslationHold(getScroller);

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
            const selectedSentences = subtitle.slice(normalizedStart, normalizedEnd + 1);
            playerActions.setVirtualGroupBySentences(selectedSentences);
        } else {
            selectionRangeRef.current = null;
            playerActions.clearVirtualGroup();
        }
    }, [subtitle]);

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
                useChatPanel.getState().hideLearning();
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
                data-testid="sentence-card"
                data-index={item.index}
                data-current={isCurrent ? 'true' : 'false'}
            >
                <SideSentence
                    sentence={item}
                    onClick={() => {
                        // handled via drag finalize logic
                    }}
                    isCurrent={isCurrent}
                    isRepeat={singleRepeat || hoverRepeat}
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
    ]);

    const render = () => {
        return (
            <div className="w-full h-full flex flex-col relative" ref={setBoundaryRef}>
                {/* 伴读剧本流状态栏 */}
                <div className="shrink-0 px-3 py-1.5 flex items-center justify-between border-b border-border/30 bg-background/50 backdrop-blur-md z-10 text-xs select-none">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-muted-foreground">{t('subtitleScript', { defaultValue: '伴读剧本' })}</span>
                        {subtitle.length > 0 && (
                            <span className="text-[11px] font-mono text-muted-foreground/70">
                                {subtitle.length} 句
                            </span>
                        )}
                        {virtualGroup.active && virtualGroup.sentences.length > 1 && (
                            <div className="flex items-center gap-1">
                                <Badge
                                    variant="teal"
                                    icon={<Repeat className="w-2.5 h-2.5" />}
                                    label={`${virtualGroup.sentences.length} 句循环`}
                                />
                                <Tooltip content={t('cancelLoop', { defaultValue: '取消选区循环' })} placement="below">
                                    <button
                                        type="button"
                                        onClick={() => playerActions.clearVirtualGroup()}
                                        className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                                        aria-label={t('cancelLoop', { defaultValue: '取消选区循环' })}
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </Tooltip>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Tooltip
                            content={showSideTranslation ? t('hideSideTranslation', { defaultValue: '隐藏侧栏译文' }) : t('showSideTranslation', { defaultValue: '显示侧栏译文' })}
                            placement="below"
                        >
                            <button
                                type="button"
                                onClick={() => changeShowSideTranslation()}
                                className={twJoin(
                                    'px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer',
                                    showSideTranslation
                                        ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                        : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                                )}
                            >
                                {t('sideTranslation', { defaultValue: '译' })}
                            </button>
                        </Tooltip>

                        {scrollState === 'USER_BROWSING' && currentListPosition >= 0 && (
                            <Tooltip content={t('controlButton.backToPlayhead')} placement="below">
                                <button
                                    type="button"
                                    onClick={() => syncIntoView(currentListPosition)}
                                    className="p-1 rounded-md text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                                    aria-label={t('controlButton.backToPlayhead')}
                                >
                                    <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>

                <div className="flex-1 min-h-0 relative">
                    <Virtuoso
                        onScroll={onScrolling}
                        scrollerRef={handleScrollerRef}
                        increaseViewportBy={200}
                        minOverscanItemCount={{ top: 3, bottom: 6 }}
                        defaultItemHeight={55}
                        ref={setVirtuoso}
                        className={twJoin(
                            'h-full w-full overflow-y-auto text-primary py-2',
                            'scrollbar-thin scrollbar-thumb-rounded-full',
                            'scrollbar-thumb-border hover:scrollbar-thumb-border-emphasized',
                            showSideBar && 'scrollbar-none'
                        )}
                        data={subtitle}
                        rangeChanged={handleRangeChanged}
                        itemContent={renderItem}
                        components={{
                            Footer: () => <div className="h-52" />,
                            Header: () => <div className={cn('h-0.5')} />,
                        }}
                    />

                    {/* 侧栏被「随英文字幕隐藏」收起时给一条唯一解释：卡片底色已隐去，避免看起来像骨架屏 */}
                    {sidebarHiddenByEnglish && (
                        <div className="absolute inset-x-0 top-4 z-10 flex justify-center pointer-events-none">
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/85 px-3 py-1 text-[11px] leading-tight text-muted-foreground backdrop-blur shadow-xs">
                                <span>{t('controlBox.sidebarHiddenByEnglish')}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium">
                                    {t('controlBox.sidebarHiddenByEnglishAction', {
                                        shortcut: toggleEnglishShortcut.toUpperCase(),
                                    })}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* 侧栏译文被关掉后就地提示并给回开按钮。
                        放在 Virtuoso 之外（absolute，不设 Header/Footer）：既不占列表行高，
                        也不会随句子卡片一起淡出——侧栏被收起时它必须还在，否则用户看不出发生了什么。 */}
                    {!showSideTranslation && (
                        <div className="absolute right-2 top-2 z-10 pointer-events-none">
                            <button
                                type="button"
                                onClick={() => changeShowSideTranslation()}
                                title={sidebarHiddenByEnglish ? t('controlBox.sidebarHiddenNow') : undefined}
                                className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-[10px] leading-tight text-muted-foreground backdrop-blur transition-colors hover:text-foreground cursor-pointer"
                            >
                                <span>{t('controlBox.sideTranslationHiddenChip')}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium">{t('controlBox.sideTranslationShowAction')}</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return render();
}
