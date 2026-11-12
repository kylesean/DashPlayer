import React from 'react';
import { Check, EyeOff, Loader2, RefreshCw, Star } from 'lucide-react';
import { Token } from '@astryxdesign/core/Token';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import Playable from '@/fronted/components/shared/common/Playable';
import { cn } from '@/fronted/lib/utils';
import { formatPhonetic } from '@/fronted/lib/phonetic';
import { DICT_TAG_I18N_KEYS } from '@/fronted/lib/dict-tags';
import { useTranslation } from 'react-i18next';
import type { WordStatus } from '@/common/types/vocabulary';
import type { WordMemoryVO } from '@/common/types/wordMemory';
import WordContextInsight from './word-context-insight';
import { formatMemoryWhen } from './word-memory-time';

/**
 * 统一音标显示格式，自动补齐首尾斜杠。
 */

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
                    <div className="px-4.5 pt-3">
                        <WordContextInsight
                            word={contextWord ?? ''}
                            sentence={contextSentence}
                            definitions={[]}
                        />
                    </div>
                    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground select-none">
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
                            <span className="text-lg font-bold text-foreground tracking-tight select-text">
                                <Playable>{data.word}</Playable>
                            </span>
                        </div>
                        {phonetic && (
                            <span className="text-sm font-mono text-muted-foreground/75 mt-0.5 inline-flex items-center gap-2 select-text">
                                <span>{phonetic}</span>
                                {statusLabel && (
                                    <span className="font-sans text-metadata text-muted-foreground/80">
                                        {statusLabel}
                                    </span>
                                )}
                            </span>
                        )}
                        {!phonetic && statusLabel && (
                            <span className="text-metadata text-muted-foreground/80 mt-0.5 inline-block">
                                {statusLabel}
                            </span>
                        )}
                        {promptReasons && promptReasons.length > 0 && (
                            <div
                                data-testid="word-prompt-reason"
                                className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-metadata text-muted-foreground/80 select-text"
                            >
                                <span>{t('wordPromptReasonLabel')}</span>
                                <span className="text-foreground/75">
                                    {promptReasons.join(' · ')}
                                </span>
                            </div>
                        )}
                        {wordMemory && (
                            <div
                                data-testid="word-memory"
                                className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-metadata text-muted-foreground/80 select-text"
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
                            <span className="text-sm text-muted-foreground/70 animate-pulse mt-0.5 inline-block select-none font-normal">
                                ···
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0 ml-2">
                        {onFavorite && (
                            <button
                                type="button"
                                onClick={onFavorite}
                                disabled={isFavoriting}
                                className={cn(
                                    'p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all cursor-pointer',
                                    isFavorited && 'text-warning-text hover:text-warning-text scale-105',
                                    isFavoriting && 'cursor-default'
                                )}
                                title={isFavorited ? t('unfavoriteWord') : t('favoriteWord')}
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
                                    'p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all cursor-pointer',
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
                                    'p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-all cursor-pointer',
                                    wordStatus === 'ignored' && 'text-foreground',
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
                                    'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer',
                                    (isLoading || isStreaming) && 'opacity-50 cursor-not-allowed'
                                )}
                                title={t('forceRefresh')}
                            >
                                <RefreshCw size={14} className={isLoading || isStreaming ? 'animate-spin' : ''} />
                            </button>
                        )}
                    </div>
                </div>

                {/* 滚动区域：释义与例句列表 */}
                <div className="px-4.5 pt-1.5 pb-4 flex-1 overflow-y-auto space-y-4 scrollbar-thin">
                    <WordContextInsight
                        word={contextWord ?? data.word}
                        sentence={contextSentence}
                        definitions={insightDefinitions}
                        className="mt-0.5"
                    />
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
                                            <span className="text-metadata font-semibold italic text-muted-foreground shrink-0 select-none">
                                                {pos}
                                            </span>
                                        )}
                                        <span className="text-base text-foreground font-medium">
                                            {def.meaning}
                                        </span>
                                    </div>

                                    {/* 例句与译文分级排版：英文例句始终大于辅助译文 */}
                                    {hasExamples && (
                                        <div className="pl-3 border-l-2 border-border/60 space-y-2.5 my-1.5">
                                            {def.examples.map((ex, exIdx) => (
                                                <div key={`ex-${exIdx}-${ex.sentence}`} className="space-y-0.5">
                                                    <div className="text-sm text-foreground/95 font-normal leading-relaxed">
                                                        <Playable>{ex.sentence}</Playable>
                                                    </div>
                                                    {ex.translation && (
                                                        <div className="text-metadata text-muted-foreground leading-relaxed">
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
                        <div className="text-sm text-muted-foreground/70 select-none py-3">
                            {isStreaming ? (
                                <div className="flex items-center gap-2 text-muted-foreground/60 animate-pulse">
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                                    <span>{t('generatingDefinition', { defaultValue: '正在查询释义…' })}</span>
                                </div>
                            ) : (
                                <span>{t('noDefinition', { defaultValue: '暂无释义' })}</span>
                            )}
                        </div>
                    )}
                    {hasEnglishSenses && (
                        <div className="pt-3 mt-1 border-t border-border/60 space-y-3">
                            <div className="text-metadata font-semibold uppercase tracking-wider text-muted-foreground select-none">
                                {t('englishSenses', { defaultValue: 'English definitions' })}
                            </div>
                            {(data?.englishSenses ?? []).map((sense, senseIdx) => {
                                const pos = formatPartOfSpeech(sense.partOfSpeech);
                                return (
                                    <div key={`en-${senseIdx}-${sense.definition}`} className="space-y-1 select-text">
                                        <div className="flex items-baseline gap-2 leading-snug">
                                            {pos && (
                                                <span className="text-metadata font-semibold italic text-muted-foreground shrink-0 select-none">
                                                    {pos}
                                                </span>
                                            )}
                                            <span className="text-sm text-foreground/90">{sense.definition}</span>
                                        </div>
                                        {sense.synonyms.length > 0 && (
                                            <div className="text-metadata text-muted-foreground pl-0.5">
                                                {t('englishSynonyms', { defaultValue: '近义' })}: {sense.synonyms.join(', ')}
                                            </div>
                                        )}
                                        {sense.antonyms.length > 0 && (
                                            <div className="text-metadata text-muted-foreground pl-0.5">
                                                {t('englishAntonyms', { defaultValue: '反义' })}: {sense.antonyms.join(', ')}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div
            className={cn(
                'w-[360px] h-[400px] bg-popover/95 backdrop-blur-2xl text-popover-foreground shadow-2xl border border-border/70 rounded-2xl overflow-hidden text-left relative flex flex-col',
                className
            )}
        >
            {isLoading && !hasContent ? renderSkeleton() : renderContent()}
        </div>
    );
};

export default OpenAIWordPop;
