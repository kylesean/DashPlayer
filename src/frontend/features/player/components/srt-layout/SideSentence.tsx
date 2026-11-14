import React, { forwardRef, useMemo, useState } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { useShallow } from 'zustand/react/shallow';
import { Bookmark, History, Play, Repeat1 } from 'lucide-react';
import { toast } from 'react-hot-toast';

import useSetting from '@/frontend/features/settings/settingsStore';
import { usePlayerUiState } from '@/frontend/features/player/playerUiStore';
import { usePlayerState } from '@/frontend/features/player/playerState';
import { usePlaybackSession } from '@/frontend/features/player/playbackSessionStore';
import { useSavedSentences } from '@/frontend/features/context-studio/savedSentencesStore';
import { cn } from '@/frontend/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';
import useTranslation from '@/frontend/features/player/translationStore';
import TimeUtil from '@/common/utils/TimeUtil';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import { renderSentenceTokens } from './sentence-token-renderer';
import { highlightSlice } from './transcript-highlight';

/**
 * 侧栏单句剧本行入参定义。
 */
export interface SideSentenceProps {
    /** 句子数据结构体。 */
    sentence: Sentence;
    /** 点击行跳转回调。 */
    onClick: (sentence: Sentence) => void;
    /** 点击「从头重播此句」按钮的回调；缺省时退化为普通跳转。 */
    onReplay?: (sentence: Sentence) => void;
    /** 是否为当前正在播放的活跃句子。 */
    isCurrent: boolean;
    /** 是否开启单句循环模式。 */
    isRepeat: boolean;
    /** 选区多句连续合并循环状态。 */
    selectionState?: {
        isMember: boolean;
        isGroupStart: boolean;
        isGroupEnd: boolean;
    };
    /** 搜索文本查询。 */
    searchQuery?: string;
    /** 是否为当前聚焦选中的搜索匹配项。 */
    isActiveSearchMatch?: boolean;
    /** 切换单句循环回调。 */
    onToggleSingleRepeat?: (sentence: Sentence) => void;
    /**
     * 本句的时间轴是否被手动调整过。
     *
     * 用户是在这一行里调的，就必须能在同一行里退回去。此前只有播客模式
     * 有复位入口，文稿里调完时间轴就再也回不来了。
     */
    isTimeAdjusted?: boolean;
    /** 清除本句的时间轴调整。 */
    onResetTime?: (sentence: Sentence) => void;
}

/**
 * 图标提示辅助封装组件。
 */
const IconTip = ({ tip, children }: { tip: string; children: React.ReactNode }) => {
    const { t } = useI18nTranslation('player');
    return (
        <Tooltip content={t(tip)} placement="above">
            {children}
        </Tooltip>
    );
};

/**
 * 播放中跳动的声波律动微动效。
 */
const PlayingAudioWave = () => (
    <IconTip tip="sideSentence.playing">
        <div className="flex items-end justify-center gap-[2px] w-3.5 h-3.5 text-accent shrink-0">
            <span className="w-[2px] h-3 bg-current rounded-full animate-[pulse_0.8s_ease-in-out_infinite]" />
            <span className="w-[2px] h-1.5 bg-current rounded-full animate-[pulse_0.6s_ease-in-out_0.2s_infinite]" />
            <span className="w-[2px] h-3.5 bg-current rounded-full animate-[pulse_0.9s_ease-in-out_0.4s_infinite]" />
        </div>
    </IconTip>
);

/**
 * 单句循环状态图标。
 */
const RepeatAudioWave = () => (
    <IconTip tip="sideSentence.singleLoop">
        <div className="flex items-center justify-center w-3.5 h-3.5 text-accent shrink-0">
            <Repeat1 className="w-3.5 h-3.5" />
        </div>
    </IconTip>
);

/**
 * 伴读剧本流单句行组件（Synchronized Script Row）。
 *
 * 遵循「影院级专注，书卷式流淌」设计哲学：
 * 1. 彻底告别卡片堆叠（Card-wrapped list anti-pattern），演进为连续流式剧本行；
 * 2. 严格坚守西文左对齐排版基线（Left-aligned baseline），根除居中排版带来的眼球折返疲劳；
 * 3. 活跃句通过左侧 3px 强调条、柔和微光底色与音频声波呈现自然聚焦；
 * 4. 非活跃行轻柔退后，悬停展现时间戳与快捷重播，提供纯粹从容的伴读体验。
 */
const SideSentence = forwardRef<HTMLDivElement, SideSentenceProps>(
    (
        {
            sentence,
            onClick,
            onReplay,
            isCurrent,
            isRepeat,
            selectionState,
            searchQuery = '',
            isActiveSearchMatch = false,
            onToggleSingleRepeat,
            isTimeAdjusted = false,
            onResetTime,
        }: SideSentenceProps,
        ref
    ) => {
        const { t } = useI18nTranslation('player');
        const playing = usePlayerState((state) => state.playing);
        const videoId = usePlaybackSession((state) => state.videoId);
        const sentenceKey = `${sentence.fileHash}:${sentence.index}`;
        const isSaved = useSavedSentences((state) => state.savedKeys.has(sentenceKey));
        const toggleSavedSentence = useSavedSentences((state) => state.toggleSentence);
        const { showSideTranslation } = usePlayerUiState(
            useShallow((s) => ({
                showSideTranslation: s.showSideTranslation,
            })),
        );

        const translationKey = sentence?.translationKey || '';
        const newTranslation =
            useTranslation((state) =>
                showSideTranslation ? state.translations.get(translationKey) : undefined,
            ) || '';

        const primaryText = sentence.text || '';
        const isZhSearchMatch = Boolean(
            searchQuery.trim() &&
            ((sentence.textZH && sentence.textZH.toLowerCase().includes(searchQuery.trim().toLowerCase())) ||
             (newTranslation && newTranslation.toLowerCase().includes(searchQuery.trim().toLowerCase())))
        );
        const secondaryText = (showSideTranslation || isZhSearchMatch) ? sentence.textZH || newTranslation || '' : '';

        const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));
        const [popEle, setPopEle] = useState<string | null>(null);

        const handleRequestPop = (k: string) => {
            if (popEle !== k) {
                setPopEle(k);
            }
        };

        const renderHighlightedText = (text: string) =>
            renderSentenceTokens({
                sentence,
                text,
                searchQuery,
                isActiveMatch: isActiveSearchMatch,
                popEle,
                onRequestPop: handleRequestPop,
            });

        /** 选区多句合并样式计算。 */
        const selectionClass = useMemo(() => {
            if (!selectionState?.isMember) {
                return '';
            }
            const classes: string[] = ['bg-accent-muted/15 text-primary'];

            if (selectionState.isGroupStart && selectionState.isGroupEnd) {
                classes.push('rounded-lg');
            } else if (selectionState.isGroupStart) {
                classes.push('rounded-t-lg rounded-b-none');
            } else if (selectionState.isGroupEnd) {
                classes.push('rounded-b-lg rounded-t-none');
            } else {
                classes.push('rounded-none');
            }
            return classes.join(' ');
        }, [selectionState]);

        const timeStr = useMemo(() => {
            if (sentence.start === undefined || sentence.start === null) return '';
            return TimeUtil.secondToTimeStrCompact(sentence.start);
        }, [sentence.start]);

        return (
            <div
                ref={ref}
                className={cn(
                    // 遵循 Astryx Item Stream：左对齐平滑流式行，微内边距，移除厚重卡片外框与左侧彩色竖线
                    'group relative mx-2 my-0.5 rounded-lg select-none transition-colors duration-150',
                    // 未在多句选区中的常规状态：依靠文字对比度与时间戳音波动效指示，彻底去除生硬的左侧彩色竖条
                    !selectionState?.isMember && (
                        isCurrent
                            ? 'bg-surface/70 text-primary'
                            : 'text-secondary hover:text-primary hover:bg-surface/40'
                    ),
                    // 激活的搜索匹配高亮项
                    isActiveSearchMatch && 'ring-1 ring-amber-500/80 bg-amber-500/10 shadow-xs',
                    selectionClass,
                )}
            >
                {/*
                  整行点击区与行内操作按钮必须是兄弟节点。

                  之前把「单句循环 / 重播」按钮放进 role="button" 的整行容器里：
                  键盘用户按 Enter 会同时触发句子跳转与按钮动作，读屏也会播报
                  两个嵌套的动作目标（WCAG 4.1.2）。现在点击区只覆盖文本区域，
                  操作栏浮在同一行的右侧，两者各自独立可聚焦。
                */}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onClick(sentence)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onClick(sentence);
                        }
                    }}
                    className={cn(
                        'w-full px-3 py-2 rounded-lg flex flex-col justify-start items-start cursor-pointer',
                        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                    )}
                >
                {/*
                  顶部行：状态指示 / 时间戳。
                  右侧留出 pr-12 给浮在行尾的操作栏，避免悬停时按钮压住时间戳。
                */}
                <div className="w-full flex items-center justify-between gap-1.5 mb-1 pr-12">
                    <div className="flex items-center gap-1.5">
                        {/* 活跃态声波动效 */}
                        {isCurrent && (
                            playing ? (isRepeat ? <RepeatAudioWave /> : <PlayingAudioWave />) : (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-bg shrink-0" />
                            )
                        )}
                        {/* 紧凑时间戳 */}
                        {timeStr && (
                            <span
                                className={cn(
                                    'text-metadata font-mono tracking-tight transition-colors',
                                    isCurrent ? 'text-primary/75 font-medium' : 'text-secondary/50 group-hover:text-secondary/75',
                                )}
                            >
                                {timeStr}
                            </span>
                        )}
                    </div>
                </div>

                {/* 英文主句文本：坚固的左对齐基线，优化的西文字体与行距 */}
                <div className="w-full text-left">
                    <div
                        className={cn(
                            'w-full text-left font-sans leading-relaxed tracking-normal select-text break-words transition-colors',
                            fontSize === 'fontSizeSmall' && 'text-side-en-small',
                            (!fontSize || fontSize === 'fontSizeMedium') && 'text-side-en-medium',
                            fontSize === 'fontSizeLarge' && 'text-side-en-large',
                            isCurrent
                                ? 'text-primary font-medium'
                                : 'text-secondary/90 group-hover:text-primary',
                        )}
                    >
                        {renderHighlightedText(primaryText)}
                    </div>

                    {/* 中文辅助译文：位于英文主句正下方，左对齐，颜色轻柔克制，形成自然的读解对照 */}
                    {secondaryText && (
                        <div
                            className={cn(
                                'w-full text-left leading-normal select-text break-words mt-1 transition-colors',
                                fontSize === 'fontSizeSmall' && 'text-side-zh-small',
                                (!fontSize || fontSize === 'fontSizeMedium') && 'text-side-zh-medium',
                                fontSize === 'fontSizeLarge' && 'text-side-zh-large',
                                isCurrent
                                    ? 'text-secondary font-normal'
                                    : 'text-secondary/60 group-hover:text-secondary/85',
                            )}
                        >
                            {highlightSlice(secondaryText, secondaryText, 0, searchQuery, isActiveSearchMatch)}
                        </div>
                    )}
                </div>
                </div>

                {/* 悬停微动作栏：收藏金句 / 单句精听循环 / 重播单句。浮在行尾，不参与整行点击区。 */}
                <div
                    className={cn(
                        'absolute right-2 top-1.5 flex items-center gap-1 transition-opacity duration-150',
                        (isCurrent && isRepeat) || isSaved ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                    )}
                >
                    <Tooltip
                        content={
                            isSaved
                                ? t('sideSentence.unsaveSentence', { defaultValue: '从语境工坊移除金句' })
                                : t('sideSentence.saveSentence', { defaultValue: '收藏为金句到语境工坊' })
                        }
                        placement="above"
                    >
                        <button
                            type="button"
                            onClick={() => {
                                void toggleSavedSentence({
                                    sentenceKey,
                                    videoId: videoId || '',
                                    fileHash: sentence.fileHash,
                                    sentenceIndex: sentence.index,
                                    startTime: sentence.adjustedStart ?? sentence.start,
                                    endTime: sentence.adjustedEnd ?? sentence.end,
                                    text: primaryText,
                                    textZh: sentence.textZH || newTranslation || '',
                                }).then((saved) => {
                                    toast.success(
                                        saved
                                            ? t('sideSentence.sentenceSaved', { defaultValue: '已收藏至语境工坊' })
                                            : t('sideSentence.sentenceUnsaved', { defaultValue: '已取消金句收藏' }),
                                    );
                                }).catch(() => {
                                    toast.error(t('sideSentence.sentenceSaveFailed', { defaultValue: '收藏操作失败' }));
                                });
                            }}
                            className={cn(
                                'p-1 rounded transition-colors cursor-pointer',
                                isSaved
                                    ? 'text-accent bg-accent-bg/15 hover:bg-accent-bg/25'
                                    : 'text-secondary hover:text-primary hover:bg-surface/80',
                            )}
                            aria-label={
                                isSaved
                                    ? t('sideSentence.unsaveSentence', { defaultValue: '从语境工坊移除金句' })
                                    : t('sideSentence.saveSentence', { defaultValue: '收藏为金句到语境工坊' })
                            }
                        >
                            <Bookmark className={cn('w-2.5 h-2.5', isSaved && 'fill-current')} />
                        </button>
                    </Tooltip>
                    <Tooltip
                        content={
                            isCurrent && isRepeat
                                ? t('sideSentence.cancelSingleLoop', { defaultValue: '关闭单句循环' })
                                : t('sideSentence.loopSentence', { defaultValue: '开启单句循环' })
                        }
                        placement="above"
                    >
                        <button
                            type="button"
                            onClick={() => {
                                if (onToggleSingleRepeat) {
                                    onToggleSingleRepeat(sentence);
                                } else if (isCurrent) {
                                    playerActions.setSingleRepeat(!isRepeat);
                                } else {
                                    playerActions.gotoSentence(sentence);
                                    playerActions.setSingleRepeat(true);
                                }
                            }}
                            className={cn(
                                'p-1 rounded transition-colors cursor-pointer',
                                isCurrent && isRepeat
                                    ? 'text-accent bg-accent-bg/20 hover:bg-accent-bg/30'
                                    : 'text-secondary hover:text-primary hover:bg-surface/80',
                            )}
                            title={
                                isCurrent && isRepeat
                                    ? t('sideSentence.cancelSingleLoop', { defaultValue: '关闭单句循环' })
                                    : t('sideSentence.loopSentence', { defaultValue: '开启单句循环' })
                            }
                            aria-label={
                                isCurrent && isRepeat
                                    ? t('sideSentence.cancelSingleLoop', { defaultValue: '关闭单句循环' })
                                    : t('sideSentence.loopSentence', { defaultValue: '开启单句循环' })
                            }
                        >
                            <Repeat1 className="w-2.5 h-2.5" />
                        </button>
                    </Tooltip>

                    {isTimeAdjusted && onResetTime && (
                        <Tooltip
                            content={t('subtitle.resetTimingTooltip', { defaultValue: '点击重置当前句子时间戳' })}
                            placement="above"
                        >
                            <button
                                type="button"
                                data-testid="side-sentence-reset-time"
                                onClick={() => onResetTime(sentence)}
                                className="p-1 rounded text-warning-text hover:bg-warning-muted transition-colors cursor-pointer"
                                title={t('subtitle.resetTimingTooltip', { defaultValue: '点击重置当前句子时间戳' })}
                                aria-label={t('subtitle.resetTimingTooltip', { defaultValue: '点击重置当前句子时间戳' })}
                            >
                                <History className="w-2.5 h-2.5" />
                            </button>
                        </Tooltip>
                    )}

                    <Tooltip content={t('sideSentence.replaySentence', { defaultValue: '从头重播此句' })} placement="above">
                        <button
                            type="button"
                            onClick={() => (onReplay ?? onClick)(sentence)}
                            className="p-1 rounded text-secondary hover:text-primary hover:bg-surface/80 transition-colors cursor-pointer"
                            title={t('sideSentence.replaySentence', { defaultValue: '从头重播此句' })}
                            aria-label={t('sideSentence.replaySentence', { defaultValue: '从头重播此句' })}
                        >
                            <Play className="w-2.5 h-2.5 fill-current" />
                        </button>
                    </Tooltip>
                </div>
            </div>
        );
    },
);

SideSentence.displayName = 'SideSentence';

export default SideSentence;
