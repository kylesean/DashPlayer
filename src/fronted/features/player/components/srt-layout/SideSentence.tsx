import React, { forwardRef, useMemo, useState } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { useShallow } from 'zustand/react/shallow';
import { Play, Repeat1 } from 'lucide-react';

import useSetting from '@/fronted/features/settings/settingsStore';
import { usePlayerUiState } from '@/fronted/features/player/playerUiStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { cn } from '@/fronted/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';
import useTranslation from '@/fronted/features/player/translationStore';
import TimeUtil from '@/common/utils/TimeUtil';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
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
        }: SideSentenceProps,
        ref
    ) => {
        const { t } = useI18nTranslation('player');
        const playing = usePlayerState((state) => state.playing);
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
                role="button"
                tabIndex={0}
                ref={ref}
                onClick={() => onClick(sentence)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClick(sentence);
                    }
                }}
                className={cn(
                    // 遵循 Astryx Item Stream：左对齐平滑流式行，微内边距，移除厚重卡片外框与左侧彩色竖线
                    'group relative mx-2 my-0.5 px-3 py-2 rounded-lg flex flex-col justify-start items-start cursor-pointer select-none transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                    // 未在多句选区中的常规状态：依靠文字对比度与时间戳音波动效指示，彻底去除生硬的左侧彩色竖条
                    !selectionState?.isMember && (
                        isCurrent
                            ? 'bg-surface/70 text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-surface/40'
                    ),
                    // 激活的搜索匹配高亮项
                    isActiveSearchMatch && 'ring-1 ring-amber-500/80 bg-amber-500/10 shadow-xs',
                    selectionClass,
                )}
            >
                {/* 顶部行：状态指示 / 时间戳 / 悬停快捷重播与单句精听循环 */}
                <div className="w-full flex items-center justify-between gap-1.5 mb-1 pointer-events-none">
                    <div className="flex items-center gap-1.5">
                        {/* 活跃态声波动效 */}
                        {isCurrent && (
                            playing ? (isRepeat ? <RepeatAudioWave /> : <PlayingAudioWave />) : (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                            )
                        )}
                        {/* 紧凑时间戳 */}
                        {timeStr && (
                            <span
                                className={cn(
                                    'text-metadata font-mono tracking-tight transition-colors',
                                    isCurrent ? 'text-foreground/75 font-medium' : 'text-muted-foreground/50 group-hover:text-muted-foreground/75',
                                )}
                            >
                                {timeStr}
                            </span>
                        )}
                    </div>

                    {/* 悬停微动作栏：单句精听循环 / 重播单句 */}
                    <div
                        className={cn(
                            'flex items-center gap-1 transition-opacity duration-150 pointer-events-auto',
                            isCurrent && isRepeat ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                        )}
                    >
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
                                onClick={(e) => {
                                    e.stopPropagation();
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
                                        ? 'text-accent bg-accent/20 hover:bg-accent/30'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-surface/80',
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

                        <Tooltip content={t('sideSentence.replaySentence', { defaultValue: '从头重播此句' })} placement="above">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    (onReplay ?? onClick)(sentence);
                                }}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface/80 transition-colors cursor-pointer"
                                title={t('sideSentence.replaySentence', { defaultValue: '从头重播此句' })}
                                aria-label={t('sideSentence.replaySentence', { defaultValue: '从头重播此句' })}
                            >
                                <Play className="w-2.5 h-2.5 fill-current" />
                            </button>
                        </Tooltip>
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
                                ? 'text-foreground font-medium'
                                : 'text-muted-foreground/90 group-hover:text-foreground',
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
                                    ? 'text-muted-foreground font-normal'
                                    : 'text-muted-foreground/60 group-hover:text-muted-foreground/85',
                            )}
                        >
                            {highlightSlice(secondaryText, secondaryText, 0, searchQuery, isActiveSearchMatch)}
                        </div>
                    )}
                </div>
            </div>
        );
    },
);

SideSentence.displayName = 'SideSentence';

export default SideSentence;
