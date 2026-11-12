import React, { useState } from 'react';
import { ChevronRight, Info, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import type { WordContextInsightResponse } from '@/common/types/wordInsight';
import { playerApi } from '@/fronted/features/player/playerApi';
import useSetting from '@/fronted/features/settings/settingsStore';
import { cn } from '@/fronted/lib/utils';

/**
 * 在例句里高亮目标词。
 *
 * §6.2 要求词卡先给「当前句子，目标词高亮」：用户点开词卡时，眼睛应该立刻落在
 * 这个词在句中的位置，而不是自己去一行文字里找。按词边界、忽略大小写匹配，
 * 找不到时原样返回——屈折变化（running / ran）不强行猜测，宁可不高亮也不高亮错词。
 *
 * @param sentence 原句。
 * @param word 目标词。
 * @returns 带高亮片段的可渲染节点。
 */
const highlightWordInSentence = (sentence: string, word: string): React.ReactNode => {
    const target = word.trim();
    if (!target) {
        return sentence;
    }
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of sentence.matchAll(pattern)) {
        const start = match.index ?? 0;
        if (start > cursor) {
            parts.push(sentence.slice(cursor, start));
        }
        parts.push(
            <mark
                key={`${start}-${match[0]}`}
                className="rounded bg-accent-muted/40 px-0.5 font-medium text-foreground"
            >
                {match[0]}
            </mark>,
        );
        cursor = start + match[0].length;
    }
    if (parts.length === 0) {
        return sentence;
    }
    if (cursor < sentence.length) {
        parts.push(sentence.slice(cursor));
    }
    return parts;
};

/** 词卡语境解读区块入参。 */
export interface WordContextInsightProps {
    /** 用户点击的单词原文。 */
    word: string;
    /** 单词所在字幕句；缺失时不展示入口。 */
    sentence?: string;
    /** 当前词卡释义，用于 grounding。 */
    definitions: string[];
    className?: string;
}

/**
 * 词卡内的按需 AI 语境解读。
 *
 * 设计约束：
 * - 默认只渲染一行次级入口，不挤占释义首屏；
 * - 只有用户点击后才发起请求，悬浮查词本身不触发推理；
 * - AI 关闭、模型未就绪或请求失败时保留本地词典释义，只做局部降级提示。
 */
const WordContextInsight: React.FC<WordContextInsightProps> = ({
    word,
    sentence,
    definitions,
    className,
}) => {
    const { t } = useTranslation('common');
    const [requested, setRequested] = useState(false);
    const dictionaryEngine = useSetting((state) => state.values.get('providers.dictionary') ?? '');
    const aiEnabled = dictionaryEngine === 'openai' || dictionaryEngine === 'local';
    const sentenceText = sentence?.trim() ?? '';
    const definitionsKey = definitions.join('\u0000');
    const shouldFetch = requested && aiEnabled && !!word.trim() && !!sentenceText;

    const { data, error, isLoading, mutate } = useSWR<WordContextInsightResponse>(
        shouldFetch ? ['ai-trans/word-insight', word, sentenceText, definitionsKey] : null,
        async ([, wordParam, sentenceParam, definitionsParam]) => playerApi.wordContextInsight({
            word: String(wordParam),
            sentence: String(sentenceParam),
            definitions: String(definitionsParam) ? String(definitionsParam).split('\u0000') : [],
        }),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    );

    if (!aiEnabled || !sentenceText || !word.trim()) {
        return null;
    }

    if (!requested) {
        return (
            <button
                type="button"
                data-testid="word-context-insight-trigger"
                title={t('aiContextInsightHint')}
                onClick={() => setRequested(true)}
                className={cn(
                    'group flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-metadata text-muted-foreground transition-colors hover:text-foreground',
                    className,
                )}
            >
                <Sparkles size={13} className="shrink-0 text-warning-text/80" />
                <span className="font-medium">{t('aiContextInsight')}</span>
                <ChevronRight
                    size={12}
                    className="ml-auto shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
                />
            </button>
        );
    }

    if (isLoading) {
        return (
            <div
                data-testid="word-context-insight-loading"
                className={cn('flex items-center gap-1.5 px-1 py-1 text-metadata text-muted-foreground', className)}
            >
                <Loader2 size={13} className="shrink-0 animate-spin" />
                <span>{t('aiContextInsightLoading')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <div
                data-testid="word-context-insight-error"
                className={cn(
                    'flex items-center gap-2 rounded-lg bg-muted/30 px-2 py-1.5 text-metadata text-muted-foreground',
                    className,
                )}
            >
                <span className="min-w-0 flex-1">{t('aiContextInsightFailed')}</span>
                <button
                    type="button"
                    onClick={() => void mutate()}
                    className="inline-flex shrink-0 items-center gap-1 text-foreground/80 underline underline-offset-2 hover:text-foreground"
                >
                    <RotateCcw size={11} />
                    {t('aiContextInsightRetry')}
                </button>
            </div>
        );
    }

    if (!data || data.status === 'unavailable') {
        return (
            <div
                data-testid="word-context-insight-unavailable"
                className={cn(
                    'flex items-start gap-1.5 px-1 py-1 text-metadata leading-relaxed text-muted-foreground/80',
                    className,
                )}
            >
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>{t('aiContextInsightUnavailable')}</span>
            </div>
        );
    }

    const insight = data.insight;
    return (
        <div
            data-testid="word-context-insight-result"
            className={cn(
                'space-y-1.5 rounded-xl border border-border/60 bg-muted/25 px-3 py-2.5',
                className,
            )}
        >
            <div className="flex items-center gap-1.5 text-metadata font-semibold uppercase tracking-wider text-muted-foreground select-none">
                <Sparkles size={12} className="shrink-0 text-warning-text/80" />
                <span>{t('aiContextInsightInSentence')}</span>
                {insight.source === 'local' && (
                    <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                        · {t('aiContextInsightLocal')}
                    </span>
                )}
            </div>
            <div className="text-sm font-medium leading-snug text-foreground select-text">
                {insight.meaning}
            </div>
            {insight.nuance && (
                <div className="text-metadata leading-relaxed text-muted-foreground select-text">
                    {insight.nuance}
                </div>
            )}
            <div className="line-clamp-2 border-l-2 border-border/60 pl-2 text-metadata italic leading-relaxed text-muted-foreground/80 select-text">
                “{highlightWordInSentence(sentenceText, word)}”
            </div>
        </div>
    );
};

export default WordContextInsight;
