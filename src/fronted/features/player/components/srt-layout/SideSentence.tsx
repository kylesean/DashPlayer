import React, { forwardRef, useMemo, useState } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Play, Repeat1 } from 'lucide-react';

import useSetting from '@/fronted/features/settings/settingsStore';
import { usePlayerUiState } from '@/fronted/features/player/playerUiStore';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { cn } from '@/fronted/lib/utils';
import type { Sentence } from '@/common/types/SentenceC';
import useTranslation from '@/fronted/features/player/translationStore';
import { useVocabularyState } from '@/fronted/features/player/vocabularyStore';
import { splitWords, isWordToken, cleanWord } from '@/common/utils/subtitle';
import TimeUtil from '@/common/utils/TimeUtil';

/**
 * 侧栏单句剧本行入参定义。
 */
export interface SideSentenceProps {
    /** 句子数据结构体。 */
    sentence: Sentence;
    /** 点击行跳转回调。 */
    onClick: (sentence: Sentence) => void;
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
}

/** 分词结构体。 */
interface TextPart {
    content: string;
    isWord: boolean;
    id: string;
    isVocab?: boolean | '';
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
    ({ sentence, onClick, isCurrent, isRepeat, selectionState }: SideSentenceProps, ref) => {
        const playing = usePlayerState((state) => state.playing);
        const { showEn, syncSide, showSideTranslation } = usePlayerUiState(
            useShallow((s) => ({
                showEn: s.showEn,
                syncSide: s.syncSide,
                showSideTranslation: s.showSideTranslation,
            })),
        );

        const translationKey = sentence?.translationKey || '';
        const newTranslation =
            useTranslation((state) =>
                showSideTranslation ? state.translations.get(translationKey) : undefined,
            ) || '';

        const primaryText = sentence.text || '';
        const secondaryText = showSideTranslation ? sentence.textZH || newTranslation || '' : '';

        const fontSize = useSetting((state) => state.values.get('appearance.fontSize'));
        const [hover, setHover] = useState(false);
        const show = !syncSide ? true : showEn;
        const concealed = !show && !hover;

        const { isVocabularyWord } = useVocabularyState(
            useShallow((s) => ({
                isVocabularyWord: s.isVocabularyWord,
                version: s.version,
            })),
        );

        /** 分割句子为词元以点亮生词本词汇。 */
        const splitText = (text: string): TextPart[] => {
            const textHash = text;
            return splitWords(text).map((w, index) => {
                const cleaned = cleanWord(w);
                return {
                    content: w,
                    isWord: isWordToken(w),
                    id: `${textHash}:${index}`,
                    isVocab: cleaned && isVocabularyWord(cleaned),
                };
            });
        };

        const renderHighlightedText = (text: string) => {
            const parts = splitText(text);
            return parts.map((part) => {
                if (part.isVocab) {
                    return (
                        <span
                            key={part.id}
                            className={cn(
                                'underline decoration-accent/60 underline-offset-4 decoration-2 font-medium transition-colors',
                                isCurrent
                                    ? 'text-accent decoration-accent'
                                    : 'text-accent hover:decoration-accent hover:text-primary',
                            )}
                        >
                            {part.content}
                        </span>
                    );
                }
                return <span key={part.id}>{part.content}</span>;
            });
        };

        /** 选区多句合并样式计算。 */
        const selectionClass = useMemo(() => {
            if (!selectionState?.isMember) {
                return '';
            }
            const classes: string[] = ['bg-accent-muted/20 border-l-[3px] border-accent text-primary'];

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
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                className={cn(
                    // 遵循 Astryx Row Stream：左对齐平滑流式行，微内边距，移除厚重卡片外框
                    'group relative mx-2 my-0.5 px-3 py-2.5 rounded-lg flex flex-col justify-start items-start cursor-pointer select-none transition-all duration-150',
                    'border-l-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    // 未在多句选区中的常规状态：
                    !selectionState?.isMember && (
                        isCurrent
                            ? 'border-l-accent bg-accent-muted/15 text-primary shadow-xs'
                            : 'border-l-transparent text-secondary hover:text-primary hover:bg-surface/60 hover:border-l-border/60'
                    ),
                    // 随英文字幕隐藏时淡化：
                    concealed && 'opacity-20 hover:opacity-100',
                    selectionClass,
                )}
            >
                {/* 顶部行：状态指示 / 时间戳 / 悬停快捷重播入口 */}
                <div className="w-full flex items-center justify-between gap-1.5 mb-1 pointer-events-none">
                    <div className="flex items-center gap-1.5">
                        {/* 活跃态声波动效 */}
                        {isCurrent && !concealed && (
                            playing ? (isRepeat ? <RepeatAudioWave /> : <PlayingAudioWave />) : (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                            )
                        )}
                        {/* 紧凑时间戳 */}
                        {timeStr && (
                            <span
                                className={cn(
                                    'text-[11px] font-mono tracking-tight transition-colors',
                                    isCurrent ? 'text-accent font-medium' : 'text-muted-foreground/60 group-hover:text-muted-foreground',
                                )}
                            >
                                {timeStr}
                            </span>
                        )}
                    </div>

                    {/* 悬停微动作栏：重播单句 */}
                    <div
                        className={cn(
                            'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-auto',
                            isCurrent && 'opacity-100',
                        )}
                    >
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClick(sentence);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-surface transition-colors cursor-pointer"
                            title="从头重播此句"
                            aria-label="从头重播此句"
                        >
                            <Play className="w-3 h-3 fill-current" />
                        </button>
                    </div>
                </div>

                {/* 英文主句文本：坚固的左对齐基线，优化的西文字体与行距 */}
                <motion.div
                    className="w-full text-left"
                    initial={false}
                    animate={{ opacity: hover || show ? 1 : 0.2 }}
                    transition={{ duration: 0.15 }}
                >
                    <div
                        className={cn(
                            'w-full text-left font-sans leading-relaxed tracking-normal select-text break-words transition-colors',
                            fontSize === 'fontSizeSmall' && 'text-[14px]',
                            (!fontSize || fontSize === 'fontSizeMedium') && 'text-[15.5px]',
                            fontSize === 'fontSizeLarge' && 'text-[17.5px]',
                            isCurrent
                                ? 'text-primary font-medium'
                                : 'text-primary/80 group-hover:text-primary',
                        )}
                    >
                        {renderHighlightedText(primaryText)}
                    </div>

                    {/* 中文辅助译文：位于英文主句正下方，左对齐，颜色轻柔克制，形成自然的读解对照 */}
                    {secondaryText && (
                        <div
                            className={cn(
                                'w-full text-left leading-normal select-text break-words mt-1 transition-colors',
                                fontSize === 'fontSizeSmall' && 'text-[12px]',
                                (!fontSize || fontSize === 'fontSizeMedium') && 'text-[13px]',
                                fontSize === 'fontSizeLarge' && 'text-[14.5px]',
                                isCurrent
                                    ? 'text-secondary font-normal'
                                    : 'text-secondary/70 group-hover:text-secondary',
                            )}
                        >
                            {secondaryText}
                        </div>
                    )}
                </motion.div>
            </div>
        );
    },
);

SideSentence.displayName = 'SideSentence';

export default SideSentence;
