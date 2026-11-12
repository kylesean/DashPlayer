import React, { useState } from 'react';
import { Check, ChevronDown, EyeOff, Loader2, RefreshCw, Star } from 'lucide-react';
import { Token } from '@astryxdesign/core/Token';
import useSWR from 'swr';
import type { DictionarySource, OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import Playable from '@/fronted/components/shared/common/Playable';
import { cn } from '@/fronted/lib/utils';
import { formatPhonetic } from '@/fronted/lib/phonetic';
import { DICT_TAG_I18N_KEYS } from '@/fronted/lib/dict-tags';
import { useTranslation } from 'react-i18next';
import type { WordStatus } from '@/common/types/vocabulary';
import type { WordMemoryVO } from '@/common/types/wordMemory';
import WordContextInsight from './word-context-insight';
import { formatMemoryWhen } from './word-memory-time';
import { settingsApi } from '@/fronted/features/settings/settingsApi';

/**
 * 统一音标显示格式，自动补齐首尾斜杠。
 */

/**
 * 释义来源的展示文案（common 命名空间）。
 */
const DICTIONARY_SOURCE_I18N_KEYS: Record<DictionarySource, string> = {
    imported: 'dictionarySourceImported',
    builtin: 'dictionarySourceBuiltin',
    ai: 'dictionarySourceAi',
};

const formatPartOfSpeech = (pos?: string) => {
    if (!pos) return '';
    const cleaned = pos.trim().replace(/\.+$/, '');
    return cleaned ? `${cleaned}.` : '';
};

interface OpenAIWordPopProps {
    data: OpenAIDictionaryResult | null | undefined;
    isLoading?: boolean;
    isStreaming?: boolean;
    onRefresh?: () => void;
    /** 点击收藏按钮；未提供时不渲染收藏入口。 */
    onFavorite?: () => void;
    /** 当前单词是否已收藏。 */
    isFavorited?: boolean;
    /** 收藏请求是否进行中。 */
    isFavoriting?: boolean;
    /** 当前单词学习状态。 */
    wordStatus?: WordStatus | null;
    /** 标记为已掌握。 */
    onMarkKnown?: () => void;
    /** 标记为忽略。 */
    onMarkIgnored?: () => void;
    /** 状态更新请求是否进行中。 */
    isUpdatingStatus?: boolean;
    /** 用户点击的单词原文，供语境解读使用。 */
    contextWord?: string;
    /** 单词所在字幕句，供语境解读使用。 */
    contextSentence?: string;
    /** 你与这个词的历史；加载中或不可用时为 null。 */
    wordMemory?: WordMemoryVO | null;
    /**
     * 为什么此刻提示这个词。
     *
     * 只在本句 ContextPack 里确实有这条候选时才有值；用户自己主动查的词
     * 通常没有系统理由，此时不渲染这一行，避免编造一个「高频 / 你查过」。
     */
    promptReasons?: string[];
    className?: string;
}

const OpenAIWordPop: React.FC<OpenAIWordPopProps> = ({
    data,
    isLoading = false,
    isStreaming = false,
    onRefresh,
    onFavorite,
    isFavorited = false,
    isFavoriting = false,
    wordStatus = null,
    onMarkKnown,
    onMarkIgnored,
    isUpdatingStatus = false,
    contextWord,
    contextSentence,
    wordMemory = null,
    promptReasons,
    className
}) => {
    const { t, i18n } = useTranslation('common');
    /**
     * 当前朗读音色（美音/英音）。
     *
     * 只用于展示——真正的合成由后端按同一设置选模型。把口音显示出来，
     * 用户才知道点喇叭听到的是英音还是美音，不必去设置页确认。
     */
    const { data: ttsVoices } = useSWR(
        'sherpa-tts/voices',
        () => settingsApi.listTtsVoices(),
        { revalidateOnFocus: false },
    );
    const voiceAccent = ttsVoices?.voices.find((voice) => voice.id === ttsVoices.selected)?.accent;
    /**
     * 第二层（学习状态 + 语境解读）是否展开。
     *
     * 两层式设计的核心：悬停查词是**瞬时**交互，用户视线还在字幕上，
     * 第一层只回答「这词什么意思」。学习状态与 AI 语境解读属于主动学习，
     * 必须由用户显式展开，否则每次悬停都弹出大量次要信息，打断沉浸。
     */
    const [detailsOpen, setDetailsOpen] = useState(false);
    const hasDefinitions = !!data && Array.isArray(data.definitions) && data.definitions.length > 0;
    const hasEnglishSenses = !!data?.englishSenses?.length;
    const hasContent = !!data && (Boolean(data.word) || hasDefinitions || hasEnglishSenses);

    const renderSkeleton = () => (
        <div className="p-4 space-y-4 h-full flex flex-col justify-start">
            <div className="flex items-center justify-between pb-1">
                <div className="space-y-2">
                    <div className="h-6 bg-muted rounded w-28 animate-pulse" />
                    <div className="h-4 bg-muted/60 rounded w-20 animate-pulse" />
                </div>
            </div>
            <div className="space-y-4 pt-1 flex-1">
                <div className="space-y-2">
                    <div className="h-5 bg-muted/80 rounded w-1/2 animate-pulse" />
                    <div className="h-4 bg-muted/40 rounded w-4/5 animate-pulse" />
                </div>
                <div className="space-y-2">
                    <div className="h-5 bg-muted/80 rounded w-2/3 animate-pulse" />
                    <div className="h-4 bg-muted/40 rounded w-3/4 animate-pulse" />
                </div>
            </div>
        </div>
    );

    const renderContent = () => {
        if (!data) {
            return (
                <div className="h-full flex flex-col">
                    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-secondary select-none">
                        {t('noDefinition')}
                    </div>
                </div>
            );
        }

        const phonetic = formatPhonetic(data.phonetic);
        const dictTags = (data.tags ?? []).filter((tag) => DICT_TAG_I18N_KEYS[tag]);
        const hasMeta = Boolean(data.collins || data.oxford || data.bnc || data.frq || dictTags.length > 0);
        const insightDefinitions = data.definitions.map((definition) => {
            const pos = formatPartOfSpeech(definition.partOfSpeech);
            return `${pos} ${definition.meaning}`.trim();
        });
        const statusLabel = wordStatus === 'learning'
            ? t('wordStatusLearning')
            : wordStatus === 'familiar'
                ? t('wordStatusFamiliar')
                : wordStatus === 'known'
                    ? t('wordStatusKnown')
                    : wordStatus === 'ignored'
                        ? t('wordStatusIgnored')
                        : null;

        return (
            <div className="h-full flex flex-col overflow-hidden">
                {/* 固定头部：单词、音标、刷新操作 */}
                <div className="px-4.5 pt-4 pb-1.5 flex items-start justify-between shrink-0">
                    <div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-base font-semibold text-primary tracking-tight select-text">
                                <Playable>{data.word}</Playable>
                            </span>
                            {voiceAccent && (
                                <span className="text-metadata text-secondary/70 select-none">
                                    {voiceAccent === 'en-GB' ? 'UK' : 'US'}
                                </span>
                            )}
                        </div>
                        {phonetic && (
                            <span className="text-sm font-mono text-secondary/75 mt-0.5 inline-flex items-center gap-2 select-text">
                                <span>{phonetic}</span>
                                {statusLabel && (
                                    <span className="font-sans text-metadata text-secondary/80">
                                        {statusLabel}
                                    </span>
                                )}
                            </span>
                        )}
                        {!phonetic && statusLabel && (
                            <span className="text-metadata text-secondary/80 mt-0.5 inline-block">
                                {statusLabel}
                            </span>
                        )}
                        {hasMeta && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-2 select-none">
                                {data.collins ? (
                                    <span
                                        className="text-metadata font-semibold text-warning-text tracking-tight"
                                        title={t('collinsRating')}
                                    >
                                        {`Collins ${'★'.repeat(data.collins)}`}
                                    </span>
                                ) : null}
                                {data.oxford ? (
                                    <Token size="sm" color="teal" label="Oxford" />
                                ) : null}
                                {data.bnc ? (
                                    <Token size="sm" color="gray" label={`BNC #${data.bnc}`} />
                                ) : null}
                                {data.frq ? (
                                    <Token size="sm" color="cyan" label={`COCA #${data.frq}`} />
                                ) : null}
                                {dictTags.map((tag) => (
                                    <Token
                                        key={tag}
                                        size="sm"
                                        color="gray"
                                        label={t(DICT_TAG_I18N_KEYS[tag])}
                                    />
                                ))}
                            </div>
                        )}
                        {isStreaming && (
                            <span className="text-sm text-secondary/70 animate-pulse mt-0.5 inline-block select-none font-normal">
                                ···
                            </span>
                        )}
                        {data.source && (
                            <span
                                data-testid="word-source"
                                className="mt-1.5 block text-metadata text-secondary/60 select-none"
                            >
                                {t(DICTIONARY_SOURCE_I18N_KEYS[data.source])}
                            </span>
                        )}
                    </div>

                    {/*
                      四个动作平铺、不折叠：查词时用户是在「一眼扫过」的状态，
                      多一次点击才能看到一个动作，比认图标更慢。
                      每个按钮都有 title/aria-label，悬停即说明后果。
                    */}
                    <div className="flex items-center gap-0.5 shrink-0 ml-2">
                        {onFavorite && (
                            <button
                                type="button"
                                onClick={onFavorite}
                                disabled={isFavoriting}
                                className={cn(
                                    'p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-muted/70 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                                    isFavorited && 'text-warning-text hover:text-warning-text scale-105',
                                    isFavoriting && 'cursor-default'
                                )}
                                title={isFavorited ? t('unfavoriteWord') : t('favoriteWord')}
                                aria-label={isFavorited ? t('unfavoriteWord') : t('favoriteWord')}
                                aria-pressed={isFavorited}
                            >
                                {isFavoriting
                                    ? <Loader2 size={15} className="animate-spin" />
                                    : <Star size={15} className={cn('transition-transform duration-150', isFavorited ? 'fill-warning scale-110' : '')} />}
                            </button>
                        )}
                        {onMarkKnown && (
                            <button
                                type="button"
                                onClick={onMarkKnown}
                                disabled={isUpdatingStatus}
                                className={cn(
                                    'p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-muted/70 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                                    wordStatus === 'known' && 'text-success-text hover:text-success-text',
                                    isUpdatingStatus && 'cursor-default opacity-60',
                                )}
                                title={t('markWordKnown')}
                                aria-label={t('markWordKnown')}
                            >
                                {isUpdatingStatus && wordStatus !== 'known'
                                    ? <Loader2 size={15} className="animate-spin" />
                                    : <Check size={15} />}
                            </button>
                        )}
                        {onMarkIgnored && (
                            <button
                                type="button"
                                onClick={onMarkIgnored}
                                disabled={isUpdatingStatus}
                                className={cn(
                                    'p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-muted/70 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                                    wordStatus === 'ignored' && 'text-primary',
                                    isUpdatingStatus && 'cursor-default opacity-60',
                                )}
                                title={t('markWordIgnored')}
                                aria-label={t('markWordIgnored')}
                            >
                                <EyeOff size={15} />
                            </button>
                        )}
                        {onRefresh && (
                            <button
                                type="button"
                                onClick={onRefresh}
                                disabled={isLoading || isStreaming}
                                className={cn(
                                    'p-1.5 rounded-md text-secondary hover:text-primary hover:bg-muted/70 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                                    (isLoading || isStreaming) && 'opacity-50 cursor-not-allowed'
                                )}
                                title={t('forceRefresh')}
                                aria-label={t('forceRefresh')}
                            >
                                <RefreshCw size={14} className={isLoading || isStreaming ? 'animate-spin' : ''} />
                            </button>
                        )}
                    </div>
                </div>

                {/* 滚动区域：释义与例句列表 */}
                <div className="px-4.5 pt-1.5 pb-4 flex-1 overflow-y-auto space-y-4 scrollbar-thin">
                    {hasDefinitions ? (
                        data.definitions.map((def, defIdx) => {
                            const pos = formatPartOfSpeech(def.partOfSpeech);
                            const hasExamples = Array.isArray(def.examples) && def.examples.length > 0;

                            return (
                                <div
                                    key={`def-${defIdx}-${def.meaning}`}
                                    className="select-text space-y-2"
                                >
                                    {/* 词性与释义单行排版 */}
                                    <div className="flex items-baseline gap-2 leading-snug">
                                        {pos && (
                                            <span className="text-metadata font-semibold italic text-secondary shrink-0 select-none">
                                                {pos}
                                            </span>
                                        )}
                                        <span className="text-sm text-primary font-medium">
                                            {def.meaning}
                                        </span>
                                    </div>

                                    {/* 例句与译文分级排版：英文例句始终大于辅助译文 */}
                                    {hasExamples && (
                                        <div className="pl-3 border-l-2 border-border/60 space-y-2.5 my-1.5">
                                            {def.examples.map((ex, exIdx) => (
                                                <div key={`ex-${exIdx}-${ex.sentence}`} className="space-y-0.5">
                                                    <div className="text-sm text-primary/95 font-normal leading-relaxed">
                                                        <Playable>{ex.sentence}</Playable>
                                                    </div>
                                                    {ex.translation && (
                                                        <div className="text-metadata text-secondary leading-relaxed">
                                                            {ex.translation}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-sm text-secondary/70 select-none py-3">
                            {isStreaming ? (
                                <div className="flex items-center gap-2 text-secondary/60 animate-pulse">
                                    <span className="w-1.5 h-1.5 rounded-full bg-secondary/40" />
                                    <span>{t('generatingDefinition', { defaultValue: '正在查询释义…' })}</span>
                                </div>
                            ) : (
                                <span>{t('noDefinition', { defaultValue: '暂无释义' })}</span>
                            )}
                        </div>
                    )}
                    {hasEnglishSenses && (
                        <div className="pt-3 mt-1 border-t border-border/60 space-y-3">
                            <div className="text-metadata font-semibold uppercase tracking-wider text-secondary select-none">
                                {t('englishSenses', { defaultValue: 'English definitions' })}
                            </div>
                            {(data?.englishSenses ?? []).map((sense, senseIdx) => {
                                const pos = formatPartOfSpeech(sense.partOfSpeech);
                                return (
                                    <div key={`en-${senseIdx}-${sense.definition}`} className="space-y-1 select-text">
                                        <div className="flex items-baseline gap-2 leading-snug">
                                            {pos && (
                                                <span className="text-metadata font-semibold italic text-secondary shrink-0 select-none">
                                                    {pos}
                                                </span>
                                            )}
                                            <span className="text-sm text-primary/90">{sense.definition}</span>
                                        </div>
                                        {sense.synonyms.length > 0 && (
                                            <div className="text-metadata text-secondary pl-0.5">
                                                {t('englishSynonyms', { defaultValue: '近义' })}: {sense.synonyms.join(', ')}
                                            </div>
                                        )}
                                        {sense.antonyms.length > 0 && (
                                            <div className="text-metadata text-secondary pl-0.5">
                                                {t('englishAntonyms', { defaultValue: '反义' })}: {sense.antonyms.join(', ')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/*
                      第二层入口放在释义之后。
                      放在释义上方时，它看起来像「释义区的标题」，用户会以为下面
                      折叠着更多释义；放在最后才符合「读完了，想深入看学习记录」的顺序。
                    */}
                    {(promptReasons?.length || wordMemory || contextSentence) && (
                        <div className="pt-3 mt-1 border-t border-border/60 space-y-2">
                            <button
                                type="button"
                                onClick={() => setDetailsOpen((open) => !open)}
                                aria-expanded={detailsOpen}
                                data-testid="word-details-toggle"
                                className={cn(
                                    'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5',
                                    'text-metadata text-secondary transition-colors',
                                    'hover:bg-muted/50 hover:text-primary cursor-pointer',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                                )}
                            >
                                <span>{t('wordDetailsToggle')}</span>
                                <ChevronDown
                                    size={14}
                                    className={cn('shrink-0 transition-transform', detailsOpen && 'rotate-180')}
                                />
                            </button>
                            {detailsOpen && (
                                <div className="space-y-2 rounded-lg bg-muted/30 px-2.5 py-2">
                                    {promptReasons && promptReasons.length > 0 && (
                                        <div
                                            data-testid="word-prompt-reason"
                                            className="space-y-1"
                                        >
                                            <div className="text-metadata text-secondary/70 select-none">
                                                {t('wordPromptReasonLabel')}
                                            </div>
                                            {/*
                                              一条理由一行。曾经把三条理由用「·」连成一串，
                                              读起来像一句没说完的话，用户看不出这是三个独立原因。
                                            */}
                                            <ul className="space-y-0.5">
                                                {promptReasons.map((reason) => (
                                                    <li
                                                        key={reason}
                                                        className="flex gap-1.5 text-metadata leading-relaxed text-primary/80 select-text"
                                                    >
                                                        <span aria-hidden="true" className="text-secondary/50">·</span>
                                                        <span>{reason}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {wordMemory && (
                                        <div
                                            data-testid="word-memory"
                                            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-metadata text-secondary/80 select-text"
                                        >
                                            <span>
                                                {t('wordMemory.lastSeen', {
                                                    when: formatMemoryWhen(
                                                        wordMemory.lastSeenAt,
                                                        i18n.language,
                                                        t,
                                                        'wordMemory.neverSeen',
                                                    ),
                                                })}
                                            </span>
                                            <span aria-hidden="true">·</span>
                                            <span>
                                                {t('wordMemory.lastReviewed', {
                                                    when: formatMemoryWhen(
                                                        wordMemory.lastReviewedAt,
                                                        i18n.language,
                                                        t,
                                                        'wordMemory.neverReviewed',
                                                    ),
                                                })}
                                            </span>
                                        </div>
                                    )}
                                    <WordContextInsight
                                        word={contextWord ?? data.word}
                                        sentence={contextSentence}
                                        definitions={insightDefinitions}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div
            className={cn(
                'w-[360px] h-[400px] bg-popover/95 backdrop-blur-2xl text-primary shadow-2xl border border-border/70 rounded-2xl overflow-hidden text-left relative flex flex-col',
                className
            )}
        >
            {isLoading && !hasContent ? renderSkeleton() : renderContent()}
        </div>
    );
};

export default OpenAIWordPop;
