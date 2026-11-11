import {cn} from "@/fronted/lib/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/fronted/components/ui/resizable';
import PlaybackStage from './Stage';
import PodcastViewer from '@/fronted/features/player/components/subtitles/PodcastViewer';
import MainSubtitle from './MainSubtitle';
import Subtitle from './components/Subtitle';
import LearningToolbar from '@/fronted/features/player/components/learning-toolbar/LearningToolbar';
import { useRef } from 'react';
import type { ImperativePanelGroupHandle } from 'react-resizable-panels';
import { BookOpen, PanelBottomOpen } from 'lucide-react';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import { useLocalStorage } from '@uidotdev/usehooks';
import StrUtil from '@/common/utils/str-util';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { usePlayerBridge } from '@/fronted/features/player/hooks/usePlayerBridge';
import { useNavigate } from 'react-router-dom';
import { usePlayerState } from '@/fronted/features/player/playerState';
import PlaybackEmptyState from './EmptyState';
import LearningPage from '@/fronted/features/chat/LearningPage';
import useChatPanel from '@/fronted/features/chat/chatStore';
import PracticePanel from '@/fronted/features/practice/PracticePanel';
import PracticeModeButton from '@/fronted/features/player/components/srt-layout/PracticeModeButton';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import LearningModeButton from './LearningModeButton';
import SubtitleGenerationPanel from './SubtitleGenerationPanel';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { CAPTION_CARD_ANCHOR_CLASS, CAPTION_CARD_CLASS } from '@/fronted/features/player/components/captionCardShell';
import useSetting from '@/fronted/features/settings/settingsStore';

const logger = getRendererLogger('PlaybackLayout');

/** 分栏默认比例（百分比）：视频 75 / 剧本 25，舞台 80 / 主字幕 20。 */
const DEFAULT_OUTER_VIDEO_SIZE = 75;
const DEFAULT_OUTER_TRANSCRIPT_SIZE = 25;
const DEFAULT_INNER_STAGE_SIZE = 80;
const DEFAULT_INNER_SUBTITLE_SIZE = 20;

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
    const practiceVisible = usePracticePanel((s) => s.visible);
    const showTranscript = useLayout((s) => s.showTranscript);
    const setTranscriptVisible = useLayout((s) => s.setTranscriptVisible);
    // 有会话时保持挂载，切回播放画面只做隐藏，避免回来时对话与滚动状态丢失
    const learningMounted = learningVisible || hasLearningContext;
    const [sizeOa, setSizeOa] = useLocalStorage<number>('split-size-oa', DEFAULT_OUTER_VIDEO_SIZE);
    const [sizeOb, setSizeOb] = useLocalStorage<number>('split-size-ob', DEFAULT_OUTER_TRANSCRIPT_SIZE);
    const [sizeIa, setSizeIa] = useLocalStorage<number>('split-size-ia', DEFAULT_INNER_STAGE_SIZE);
    const [sizeIb, setSizeIb] = useLocalStorage<number>('split-size-ib', DEFAULT_INNER_SUBTITLE_SIZE);
    const [toolbarPinned, setToolbarPinned] = useLocalStorage<boolean>('dashplayer.learning_toolbar_pinned', true);
    const outerGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const innerGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const transcriptPosition = (useSetting((s) => s.setting('appearance.transcriptPosition')) || 'right') as 'left' | 'right';
    const isLeftTranscript = transcriptPosition === 'left';
    const navigate = useNavigate();
    const { handlePlayerReady, handleAutoPlayNext } = usePlayerBridge(navigate);

    const rootContainerRef = useRef<HTMLDivElement>(null);


    const containerClass = cn(
        'relative w-full h-full flex flex-col overflow-hidden bg-background'
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
     */
    const resetOuterLayout = () => {
        outerGroupRef.current?.setLayout(
            isLeftTranscript
                ? [DEFAULT_OUTER_TRANSCRIPT_SIZE, DEFAULT_OUTER_VIDEO_SIZE]
                : [DEFAULT_OUTER_VIDEO_SIZE, DEFAULT_OUTER_TRANSCRIPT_SIZE]
        );
        setSizeOa(DEFAULT_OUTER_VIDEO_SIZE);
        setSizeOb(DEFAULT_OUTER_TRANSCRIPT_SIZE);
    };

    /** 把舞台/主字幕的竖向分栏恢复成默认比例。 */
    const resetInnerLayout = () => {
        innerGroupRef.current?.setLayout([DEFAULT_INNER_STAGE_SIZE, DEFAULT_INNER_SUBTITLE_SIZE]);
        setSizeIa(DEFAULT_INNER_STAGE_SIZE);
        setSizeIb(DEFAULT_INNER_SUBTITLE_SIZE);
    };

    const videoStagePanel = (
        <ResizablePanel
            key="video-stage-panel"
            defaultSize={sizeOa}
            onResize={(e) => {
                // 全屏不记忆；文稿收起时视频面板会被拉到 100%，这是临时形态，
                // 不能覆盖用户拖出来的比例，否则收起态退出后下次会以 100% 启动。
                if (fullScreen || !showTranscript) {
                    return;
                }
                logger.debug('Outer panel resized', { size: e });
                setSizeOa(e);
            }}
        >
            <div className="relative w-full h-full overflow-hidden">
                {/* 视频与主字幕：学习页打开时只隐藏不卸载，切回播放时视频元素、播放进度与滚动位置全部保留 */}
                <ResizablePanelGroup
                    direction={'vertical'}
                    className={cn('relative z-10', (learningVisible || practiceVisible) && 'invisible')}
                >
                    <ResizablePanel
                        minSize={10}
                        defaultSize={sizeIa}
                        onResize={(e) => {
                            if (fullScreen) {
                                return;
                            }
                            setSizeIa(e);
                        }}
                    >
                        <PlaybackStage
                            className="w-full h-full"
                            onReady={handlePlayerReady}
                            onEnded={handleAutoPlayNext}
                        />
                    </ResizablePanel>
                    {!fullScreen && !podcastMode && (
                        <>
                            <ResizableHandle
                                onDoubleClick={resetInnerLayout}
                                title={t('layout.resetSplitHint')}
                                className={cn(
                                    'group relative h-1.5 w-full flex items-center justify-center',
                                    'bg-border/30 hover:bg-accent/40',
                                    'after:hidden transition-colors duration-150 cursor-row-resize z-20'
                                )}
                            >
                                <div className="w-10 h-1 rounded-full bg-muted-foreground/30 group-hover:bg-accent group-hover:w-14 transition-all duration-200" />
                            </ResizableHandle>
                            <ResizablePanel
                                className={cn('overflow-hidden bg-surface/70 backdrop-blur-2xl')}
                                minSize={0}
                                defaultSize={sizeIb}
                                onResize={(e) => {
                                    if (fullScreen) {
                                        return;
                                    }
                                    setSizeIb(e);
                                }}
                            >
                                {/* 字幕内容 + 学习台：学习台占布局的一行，任何内容都盖不到它；
                                    没有字幕时也保留学习台，训练/设置入口不会随字幕一起消失 */}
                                <div className="group/subtitles relative flex h-full w-full flex-col">
                                    <div className="min-h-0 flex-1">
                                        {hasSubTitle ? <MainSubtitle /> : <SubtitleGenerationPanel />}
                                    </div>
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
                                                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface/80 hover:bg-surface text-muted-foreground hover:text-foreground border border-border/60 shadow-xs backdrop-blur-md transition-all cursor-pointer"
                                                    aria-label={t('controlBar.showLearningToolbar', { defaultValue: '展开操作栏' })}
                                                >
                                                    <PanelBottomOpen className="w-3.5 h-3.5" />
                                                </button>
                                            </Tooltip>
                                        </div>
                                    )}
                                </div>
                            </ResizablePanel>
                        </>
                    )}
                </ResizablePanelGroup>

                {/* 播客模式：作为顶层全屏覆盖层呈现，保留底部的 PlaybackStage 与 Panel 结构完整稳定 */}
                {podcastMode && (
                    <PodcastViewer className="absolute inset-0 z-30" />
                )}

                {/* 跟读/听写练习页：占据视频与主字幕的位置，渲染在整句学习页之前（同 z 值，后开者覆盖） */}
                {practiceVisible && (
                    <div className="absolute inset-0 z-20">
                        <PracticePanel/>
                    </div>
                )}
                {practiceVisible && (
                    <div className={cn(CAPTION_CARD_ANCHOR_CLASS, 'z-30 pointer-events-auto', CAPTION_CARD_CLASS)}>
                        <PracticeModeButton/>
                    </div>
                )}

                {/* 整句学习页：占据视频与主字幕的位置，与播放器同一套外壳 */}
                {learningMounted && (
                    <div className={cn('absolute inset-0 z-20', !learningVisible && 'invisible')}>
                        <LearningPage/>
                    </div>
                )}

                {/* 学习界面右下角的学习开关：外壳与播放画面胶囊同款、锚点相同，按钮落点因此不变 */}
                {learningVisible && (
                    <div className={cn(CAPTION_CARD_ANCHOR_CLASS, 'z-30 pointer-events-auto', CAPTION_CARD_CLASS)}>
                        <LearningModeButton/>
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
                                    'flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium cursor-pointer select-none',
                                    'bg-surface/85 hover:bg-surface text-muted-foreground hover:text-foreground border border-border/70 shadow-xs backdrop-blur-md transition-all duration-150',
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
        </ResizablePanel>
    );

    const subtitlePanel = (
        <ResizablePanel
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
            <Subtitle />
        </ResizablePanel>
    );

    const splitHandle = (
        <ResizableHandle
            key="outer-split-handle"
            onDoubleClick={resetOuterLayout}
            title={t('layout.resetSplitHint')}
            className={cn(
                'group relative w-1.5 h-full flex items-center justify-center',
                'bg-border/30 hover:bg-accent/40',
                'after:hidden transition-colors duration-150 cursor-col-resize z-20'
            )}
        >
            <div className="w-1 h-12 rounded-full bg-muted-foreground/30 group-hover:bg-accent group-hover:h-16 transition-all duration-200" />
        </ResizableHandle>
    );

    return (
        <div ref={rootContainerRef} className={containerClass}>
            {/* 媒体错误最小诊断：播放修复链路已删除，本地视频兼容性问题在这里给出明确出口 */}
            {mediaErrorCode !== null && (
                <div className="absolute inset-x-0 top-3 z-30 mx-auto w-fit max-w-[90%] rounded-lg bg-warning/95 px-4 py-2 text-sm font-medium text-media-bg shadow-lg">
                    {t('mediaError.hint', { code: mediaErrorCode })}
                </div>
            )}
            <ResizablePanelGroup
                ref={outerGroupRef}
                key={`layout-group-${transcriptPosition}`}
                className={cn(
                    'relative z-10 bg-transparent'
                )}
                direction={'horizontal'}
            >
                {isLeftTranscript ? (
                    <>
                        {!fullScreen && showTranscript && subtitlePanel}
                        {!fullScreen && showTranscript && splitHandle}
                        {videoStagePanel}
                    </>
                ) : (
                    <>
                        {videoStagePanel}
                        {!fullScreen && showTranscript && splitHandle}
                        {!fullScreen && showTranscript && subtitlePanel}
                    </>
                )}
            </ResizablePanelGroup>
        </div>
    );
}

export default PlaybackLayout;
