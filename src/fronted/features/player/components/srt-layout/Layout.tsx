import {cn} from "@/fronted/lib/utils";
import { SplitHandle, SplitLayout, SplitPane } from '@/fronted/components/layout/SplitLayout';
import PlaybackStage from './Stage';
import PodcastViewer from '@/fronted/features/player/components/subtitles/PodcastViewer';
import MainSubtitle from './MainSubtitle';
import Subtitle from './components/Subtitle';
import LearningToolbar from '@/fronted/features/player/components/learning-toolbar/LearningToolbar';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImperativePanelGroupHandle } from 'react-resizable-panels';
import { BookOpen, EyeOff, PanelBottomOpen } from 'lucide-react';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import { useLocalStorage } from '@uidotdev/usehooks';
import StrUtil from '@/common/utils/str-util';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { usePlayerBridge } from '@/fronted/features/player/hooks/usePlayerBridge';
import { useLearningRouteSync } from '@/fronted/features/player/hooks/useLearningRouteSync';
import { buildLearningSessionKey } from '@/fronted/features/player/learningSessionStore';
import { useRecapPromptStore } from '@/fronted/features/player/components/learning-toolbar/recapPromptStore';
import RecapEndedPrompt from '@/fronted/features/player/components/learning-toolbar/RecapEndedPrompt';
import { useNavigate } from 'react-router-dom';
import { usePlayerState } from '@/fronted/features/player/playerState';
import PlaybackEmptyState from './EmptyState';
import LearningPage from '@/fronted/features/chat/LearningPage';
import useChatPanel from '@/fronted/features/chat/chatStore';
import { subscribeMiniStageTarget } from '@/fronted/features/chat/miniStageTarget';
import PracticePanel from '@/fronted/features/practice/PracticePanel';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import SubtitleGenerationPanel from './SubtitleGenerationPanel';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import useSetting from '@/fronted/features/settings/settingsStore';
import {
    DEFAULT_INNER_STAGE_SIZE,
    DEFAULT_INNER_SUBTITLE_SIZE,
    DEFAULT_OUTER_TRANSCRIPT_SIZE,
    DEFAULT_OUTER_VIDEO_SIZE,
    getDefaultInnerSplit,
} from './splitLayoutDefaults';

const logger = getRendererLogger('PlaybackLayout');

const PlaybackLayout = () => {
    const { t } = useI18nTranslation('player');
    const hasSubTitle = usePlaybackSession((s) => StrUtil.isNotBlank(s.subtitlePath));
    /** 底层媒体错误码；null 表示无错误。用于在旧播放修复链路删除后给出最小诊断提示。 */
    const mediaErrorCode = usePlayer((s) => s.mediaErrorCode);
    const fullScreen = useLayout((s) => s.fullScreen);
    const podcastMode = useLayout(s => s.podcastMode);
    const hasSource = usePlayerState((s) => !!s.src);
    const hasLearningContext = useChatPanel((s) => s.hasLearningContext);
    const learningVisible = useChatPanel((s) => s.learningVisible);
    const miniVideoCollapsed = useChatPanel((s) => s.miniVideoCollapsed);
    const practiceVisible = usePracticePanel((s) => s.visible);
    const practiceMode = usePracticePanel((s) => s.mode);
    const practiceFocusMode = usePracticePanel((s) => s.focusMode);
    const dictationRevealed = usePracticePanel((s) => s.dictationRevealed);
    const peekingSpoiler = usePracticePanel((s) => s.peekingSpoiler);
    const showTranscript = useLayout((s) => s.showTranscript);
    const setTranscriptVisible = useLayout((s) => s.setTranscriptVisible);
    // 整句学习打开时自动收起独立右栏全文，释放 100% 窗口宽度给 AI-Native 双栏工作台
    const effectiveShowTranscript = showTranscript && !(practiceVisible && practiceFocusMode) && !learningVisible;
    const transcriptSpoilerVeil = practiceVisible
        && !practiceFocusMode
        && practiceMode === 'dictation'
        && !dictationRevealed
        && !peekingSpoiler;
    // 有会话时保持挂载，切回播放画面只做隐藏，避免回来时对话与滚动状态丢失
    const learningMounted = learningVisible || hasLearningContext;
    const [sizeOa, setSizeOa] = useLocalStorage<number>('split-size-oa', DEFAULT_OUTER_VIDEO_SIZE);
    const [sizeOb, setSizeOb] = useLocalStorage<number>('split-size-ob', DEFAULT_OUTER_TRANSCRIPT_SIZE);
    const [sizeIa, setSizeIa] = useLocalStorage<number>('split-size-ia', DEFAULT_INNER_STAGE_SIZE);
    const [sizeIb, setSizeIb] = useLocalStorage<number>('split-size-ib', DEFAULT_INNER_SUBTITLE_SIZE);
    const [toolbarPinned, setToolbarPinned] = useLocalStorage<boolean>('refrain.learning_toolbar_pinned', true);
    const outerGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const innerGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const prePracticeSplitRef = useRef<[number, number] | null>(null);
    const prevPracticeVisibleRef = useRef(practiceVisible);
    const transcriptPosition = (useSetting((s) => s.values.get('appearance.transcriptPosition')) || 'right') as 'left' | 'right';
    const fontSize = useSetting((s) => s.values.get('appearance.fontSize'));
    const isLeftTranscript = transcriptPosition === 'left';
    const navigate = useNavigate();
    const { handlePlayerReady, handleAutoPlayNext } = usePlayerBridge(navigate);
    const handleStageEnded = useCallback(() => {
        // 先提示复盘，再考虑自动连播：这是用户刚看完一段内容的时刻，
        // 提示不阻断任何操作，用户可以继续看下一集或直接关闭。
        const { videoId, srtHash } = usePlaybackSession.getState();
        useRecapPromptStore.getState().requestPrompt(
            buildLearningSessionKey(videoId ?? null, srtHash ?? null),
        );
        void handleAutoPlayNext();
    }, [handleAutoPlayNext]);
    // 学习页的地址同步：/player/:id/learn 是入口与退出依据，不再依赖工具条是否可见
    useLearningRouteSync();

    const rootContainerRef = useRef<HTMLDivElement>(null);
    const [miniTargetEl, setMiniTargetEl] = useState<HTMLDivElement | null>(null);
    const [pipRect, setPipRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

    useEffect(() => subscribeMiniStageTarget(setMiniTargetEl), []);

    useEffect(() => {
        if (!learningVisible || miniVideoCollapsed || !miniTargetEl) {
            return;
        }
        const updateRect = () => {
            const rect = miniTargetEl.getBoundingClientRect();
            if (rect.width > 16 && rect.height > 16) {
                setPipRect({
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                });
            }
        };
        updateRect();
        const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateRect) : null;
        resizeObserver?.observe(miniTargetEl);
        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updateRect);
            window.removeEventListener('scroll', updateRect, true);
        };
    }, [learningVisible, miniVideoCollapsed, miniTargetEl]);

    const stageFloatingStyle: React.CSSProperties | undefined = learningVisible
        ? (!miniVideoCollapsed && miniTargetEl && pipRect
            ? {
                position: 'fixed',
                left: pipRect.left,
                top: pipRect.top,
                width: pipRect.width,
                height: pipRect.height,
                zIndex: 35,
                visibility: 'visible',
                pointerEvents: 'auto',
                borderRadius: 12,
                overflow: 'hidden',
            }
            : {
                position: 'fixed',
                left: -9999,
                top: -9999,
                width: 240,
                height: 135,
                opacity: 0,
                pointerEvents: 'none',
                visibility: 'hidden',
            })
        : undefined;

    // 练习工作台打开/切换专注态时动态保底底栏高度，退出时复原用户原比例而不污染持久化设置
    useEffect(() => {
        const wasVisible = prevPracticeVisibleRef.current;
        prevPracticeVisibleRef.current = practiceVisible;
        const group = innerGroupRef.current;

        if (!wasVisible && practiceVisible) {
            prePracticeSplitRef.current = [sizeIa, sizeIb];
        }

        if (practiceVisible) {
            if (group && group.getLayout().length === 2) {
                const [, baseSub] = prePracticeSplitRef.current ?? [sizeIa, sizeIb];
                const nextDock = practiceFocusMode ? 64 : Math.max(46, baseSub);
                const nextStage = Math.max(20, 100 - nextDock);
                group.setLayout([nextStage, nextDock]);
            }
            return;
        }

        if (wasVisible && prePracticeSplitRef.current) {
            const [restoreStage, restoreSub] = prePracticeSplitRef.current;
            prePracticeSplitRef.current = null;
            if (group && group.getLayout().length === 2) {
                group.setLayout([restoreStage, restoreSub]);
            }
        }
    }, [practiceVisible, practiceFocusMode, sizeIa, sizeIb]);


    const containerClass = cn(
        'relative w-full h-full flex flex-col overflow-hidden bg-body'
    );

    if (!hasSource) {
        return (
            <div className={containerClass}>
                <PlaybackEmptyState className="w-full" />
            </div>
        );
    }

    /**
     * 把视频/剧本的分栏恢复成默认比例。
     *
     * 面板顺序会随笔剧停靠方向翻转，所以重置值必须按当前顺序给出；
     * 同时写回 localStorage，下一次打开还是这个比例。
     *
     * 字幕文稿收起时这一组只剩一个面板，setLayout 会因布局长度不匹配直接抛错，
     * 所以要先确认两个面板都还在。
     */
    const resetOuterLayout = () => {
        const group = outerGroupRef.current;
        if (!group || group.getLayout().length !== 2) {
            return;
        }
        group.setLayout(
            isLeftTranscript
                ? [DEFAULT_OUTER_TRANSCRIPT_SIZE, DEFAULT_OUTER_VIDEO_SIZE]
                : [DEFAULT_OUTER_VIDEO_SIZE, DEFAULT_OUTER_TRANSCRIPT_SIZE]
        );
        setSizeOa(DEFAULT_OUTER_VIDEO_SIZE);
        setSizeOb(DEFAULT_OUTER_TRANSCRIPT_SIZE);
    };

    /**
     * 把舞台/主字幕的竖向分栏恢复成默认比例；大字号和整句模式各多给 3%。
     *
     * 播客模式与全屏会隐藏主字幕，这一组只剩舞台一个面板；同样不能强行 setLayout。
     */
    const resetInnerLayout = () => {
        const group = innerGroupRef.current;
        if (!group || group.getLayout().length !== 2) {
            return;
        }
        const { stage: stageSize, subtitle: subtitleSize } = getDefaultInnerSplit(fontSize);
        group.setLayout([stageSize, subtitleSize]);
        setSizeIa(stageSize);
        setSizeIb(subtitleSize);
    };

    /**
     * 同时恢复左右与上下两组分栏。
     *
     * 两个分隔条共用「双击恢复默认」的提示，但此前各自只重置自己那一组：
     * 用户拖过上下字幕分栏，却双击了左右分隔条时，看起来就像完全没反应。
     */
    const resetSplitLayout = () => {
        resetOuterLayout();
        resetInnerLayout();
    };

    const videoStagePanel = (
        <SplitPane
            key="video-stage-panel"
            defaultSize={sizeOa}
            onResize={(e) => {
                // 全屏不记忆；文稿收起时视频面板会被拉到 100%，这是临时形态，
                // 不能覆盖用户拖出来的比例，否则收起态退出后下次会以 100% 启动。
                if (fullScreen || !effectiveShowTranscript) {
                    return;
                }
                logger.debug('Outer panel resized', { size: e });
                setSizeOa(e);
            }}
        >
            <div className="relative w-full h-full overflow-hidden">
                {/* 视频与主字幕：学习页打开时隐藏底层界面但抬高层级让唯一微画中画舞台越过 LearningPage (z-20) 显现 */}
                <SplitLayout
                    ref={innerGroupRef}
                    direction={'vertical'}
                    className={cn(
                        'relative',
                        learningVisible ? 'z-30 invisible pointer-events-none' : 'z-10',
                    )}
                >
                    <SplitPane
                        minSize={10}
                        defaultSize={sizeIa}
                        onResize={(e) => {
                            if (fullScreen || practiceVisible) {
                                return;
                            }
                            setSizeIa(e);
                        }}
                    >
                        <div className="w-full h-full" style={stageFloatingStyle}>
                            <PlaybackStage
                                className="w-full h-full"
                                compact={learningVisible}
                                onReady={handlePlayerReady}
                                onEnded={handleStageEnded}
                            />
                        </div>
                    </SplitPane>
                    {(!fullScreen || practiceVisible) && !podcastMode && (
                        <>
                            <SplitHandle
                                data-testid="playback-split-handle-inner"
                                onDoubleClick={resetSplitLayout}
                                title={t('layout.resetSplitHint')}
                                aria-label={t('layout.resetSplitHint')}
                                className={cn(
                                    'group relative h-1.5 w-full flex items-center justify-center',
                                    'bg-border/30 hover:bg-accent-bg/40',
                                    'after:hidden transition-colors duration-150 cursor-row-resize z-20'
                                )}
                            >
                                <div className="w-10 h-1 rounded-full bg-secondary/30 group-hover:bg-accent-bg group-hover:w-14 transition-all duration-200" />
                            </SplitHandle>
                            <SplitPane
                                className={cn('overflow-hidden bg-surface/70 backdrop-blur-2xl')}
                                minSize={0}
                                defaultSize={sizeIb}
                                onResize={(e) => {
                                    if (fullScreen || practiceVisible) {
                                        return;
                                    }
                                    setSizeIb(e);
                                }}
                            >
                                {practiceVisible ? (
                                    <PracticePanel />
                                ) : (
                                    <div className="group/subtitles relative flex h-full w-full flex-col">
                                        <div className="min-h-0 flex-1">
                                            {hasSubTitle ? <MainSubtitle /> : <SubtitleGenerationPanel />}
                                        </div>
                                        <RecapEndedPrompt />
                                        <LearningToolbar
                                            pinned={toolbarPinned}
                                            onTogglePinned={() => setToolbarPinned(!toolbarPinned)}
                                        />
                                        {!toolbarPinned && (
                                            <div className="absolute bottom-2 right-2 z-20 opacity-0 group-hover/subtitles:opacity-100 transition-opacity duration-200">
                                                <Tooltip content={t('controlBar.showLearningToolbar', { defaultValue: '展开操作栏' })} placement="above">
                                                    <button
                                                        type="button"
                                                        onClick={() => setToolbarPinned(true)}
                                                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface/80 hover:bg-surface text-secondary hover:text-primary border border-border/60 shadow-xs backdrop-blur-md transition-all cursor-pointer"
                                                        aria-label={t('controlBar.showLearningToolbar', { defaultValue: '展开操作栏' })}
                                                    >
                                                        <PanelBottomOpen className="w-3.5 h-3.5" />
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </SplitPane>
                        </>
                    )}
                </SplitLayout>

                {/* 播客模式：作为顶层全屏覆盖层呈现，保留底部的 PlaybackStage 与 Panel 结构完整稳定 */}
                {podcastMode && (
                    <PodcastViewer className="absolute inset-0 z-30" />
                )}

                {/* 整句学习页：全窗级双栏精读工作台 */}
                {learningMounted && (
                    <div className={cn('absolute inset-0 z-20', !learningVisible && 'invisible pointer-events-none')}>
                        <LearningPage/>
                    </div>
                )}

                {/* 字幕文稿收起时，在画面右上角提供优雅直观的恢复把手，杜绝“收起后找不到还原入口” */}
                {!showTranscript && !fullScreen && !learningVisible && !practiceVisible && (
                    <div className="absolute top-3 right-3 z-30 pointer-events-auto">
                        <Tooltip content={t('controlButton.openTranscript', { defaultValue: '展开字幕文稿' })} placement="below">
                            <button
                                type="button"
                                onClick={() => setTranscriptVisible(true)}
                                className={cn(
                                    'flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-sm font-medium cursor-pointer select-none',
                                    'bg-surface/85 hover:bg-surface text-secondary hover:text-primary border border-border/70 shadow-xs backdrop-blur-md transition-all duration-150',
                                    'hover:scale-105 active:scale-95'
                                )}
                                aria-label={t('controlButton.openTranscript', { defaultValue: '展开字幕文稿' })}
                            >
                                <BookOpen className="w-3.5 h-3.5 text-accent" />
                                <span>{t('subtitleScript', { defaultValue: '字幕文稿' })}</span>
                            </button>
                        </Tooltip>
                    </div>
                )}
            </div>
        </SplitPane>
    );

    const subtitlePanel = (
        <SplitPane
            key="subtitle-script-panel"
            className={cn(
                'relative overflow-hidden backdrop-blur-2xl transition-colors duration-300',
                isLeftTranscript ? 'border-r border-border/40' : 'border-l border-border/40',
                learningVisible
                    ? 'bg-surface/90'
                    : 'bg-body/60 dark:bg-body/40'
            )}
            defaultSize={sizeOb}
            onResize={(e) => {
                if (fullScreen) {
                    return;
                }
                setSizeOb(e);
            }}
        >
            <div className="group/subtitlepanel relative h-full w-full">
                <Subtitle />
                {transcriptSpoilerVeil && (
                    <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-surface/85 backdrop-blur-md transition-opacity duration-150 group-hover/subtitlepanel:opacity-0 group-hover/subtitlepanel:pointer-events-none">
                        <EyeOff className="h-5 w-5 text-secondary" />
                        <p className="px-6 text-center text-sm text-secondary">
                            {t('practice:dictation.spoilerVeilHint', { defaultValue: '听写防剧透保护中 · 鼠标移入或按住 \\ 临时查看原文' })}
                        </p>
                    </div>
                )}
            </div>
        </SplitPane>
    );

    const splitHandle = (
        <SplitHandle
            key="outer-split-handle"
            data-testid="playback-split-handle-outer"
            onDoubleClick={resetSplitLayout}
            title={t('layout.resetSplitHint')}
            aria-label={t('layout.resetSplitHint')}
            className={cn(
                'group relative w-1.5 h-full flex items-center justify-center',
                'bg-border/30 hover:bg-accent-bg/40',
                'after:hidden transition-colors duration-150 cursor-col-resize z-20'
            )}
        >
            <div className="w-1 h-12 rounded-full bg-secondary/30 group-hover:bg-accent-bg group-hover:h-16 transition-all duration-200" />
        </SplitHandle>
    );

    return (
        <div ref={rootContainerRef} className={containerClass}>
            {/* 媒体错误最小诊断：播放修复链路已删除，本地视频兼容性问题在这里给出明确出口 */}
            {mediaErrorCode !== null && (
                <div className="absolute inset-x-0 top-3 z-30 mx-auto w-fit max-w-[90%] rounded-lg bg-warning/95 px-4 py-2 text-sm font-medium text-media-bg shadow-lg">
                    {t('mediaError.hint', { code: mediaErrorCode })}
                </div>
            )}
            <SplitLayout
                ref={outerGroupRef}
                key={`layout-group-${transcriptPosition}`}
                className={cn(
                    'relative z-10 bg-transparent'
                )}
                direction={'horizontal'}
            >
                {isLeftTranscript ? (
                    <>
                        {!fullScreen && effectiveShowTranscript && subtitlePanel}
                        {!fullScreen && effectiveShowTranscript && splitHandle}
                        {videoStagePanel}
                    </>
                ) : (
                    <>
                        {videoStagePanel}
                        {!fullScreen && effectiveShowTranscript && splitHandle}
                        {!fullScreen && effectiveShowTranscript && subtitlePanel}
                    </>
                )}
            </SplitLayout>
        </div>
    );
}

export default PlaybackLayout;
