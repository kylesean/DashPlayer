import React from 'react';
import type { Sentence } from '@/common/types/SentenceC';
import { splitWords, isWordToken, cleanWord } from '@/common/utils/subtitle';
import Word, { type WordParam } from '@/frontend/features/player/components/translatable-line/word';
import { cn } from '@/frontend/lib/utils';
import { highlightSlice } from './transcript-highlight';

export interface RenderSentenceTokensOptions {
    sentence: Sentence;
    text: string;
    searchQuery?: string;
    isActiveMatch?: boolean;
    popEle: string | null;
    onRequestPop: (key: string) => void;
    /** 是否显示原文；false 时原文透明（悬停显形），用于主字幕的"隐藏英文"模式。 */
    show?: boolean;
    /** 是否强制深色主题词样式；讲稿流为 true，主字幕跟随主题。 */
    alwaysDark?: boolean;
    /** Word 样式覆盖；不传时使用主题默认样式（主字幕），讲稿流传入下划线高亮样式。 */
    wordClassNames?: WordParam['classNames'];
    /** 遭遇事件使用的句子标识；主字幕沿用 sentence.key，讲稿流使用 fileHash:index。 */
    sentenceHash?: string;
    /**
     * 所在界面层：主字幕还是右侧文稿。
     *
     * `familiar` 在两处的呈现不同（§6.1）：主字幕默认不标记，右侧文稿给弱提示。
     * 渲染逻辑共用，差异只由这一个开关表达，避免两侧各写一份判定。
     */
    surface?: 'subtitle' | 'transcript';
}

/**
 * 讲稿流的词样式（下划线高亮）。主字幕传入空对象以复用主题默认样式。
 */
export const TRANSCRIPT_WORD_CLASS_NAMES: NonNullable<WordParam['classNames']> = {
    word: 'px-0.5 rounded text-inherit transition-colors cursor-pointer select-text',
    hover: 'hover:bg-accent-bg/15 hover:text-accent',
    vocab: 'underline decoration-accent/70 underline-offset-4 decoration-1 font-medium',
    vocabFamiliar: 'underline decoration-dotted decoration-accent/45 underline-offset-4 decoration-1',
};

/**
 * 伴读文稿通用分词与单词交互渲染器。
 *
 * 统一用于单句精析列表（SideSentence）、连贯讲稿流（ArticleBlock）与主/全屏字幕行，
 * 杜绝近百行分词、词形还原、搜索高亮与词典弹窗绑定逻辑的重复实现。
 * 后端 blocks 缺失时回退标点/空格切词，主路径不再因缺字段崩溃。
 */
export function renderSentenceTokens({
    sentence,
    text,
    searchQuery = '',
    isActiveMatch = false,
    popEle,
    onRequestPop,
    show = true,
    alwaysDark = true,
    wordClassNames = TRANSCRIPT_WORD_CLASS_NAMES,
    sentenceHash,
    surface = 'transcript',
}: RenderSentenceTokensOptions): React.ReactNode {
    const textHash = sentenceHash ?? `${sentence.fileHash}:${sentence.index}`;
    const gapClass = cn('whitespace-pre-wrap select-text', !show && 'text-transparent');

    // 优先利用后端经过 NLP 分词与词形还原的 blocks 数据
    if (sentence.struct?.blocks && sentence.struct.blocks.length > 0) {
        let sourceCursor = 0;
        const parts = sentence.struct.blocks.flatMap((block) => block.blockParts);
        const rendered = parts.flatMap((part, partIndex) => {
            const rawStart = text.indexOf(part.content, sourceCursor);
            const start = rawStart >= sourceCursor ? rawStart : sourceCursor;
            const gap = start > sourceCursor ? text.slice(sourceCursor, start) : '';
            const gapStart = sourceCursor;
            sourceCursor = start + part.content.length;
            const partId = `${textHash}:${partIndex}`;
            const gapElement = gap ? (
                <span className={gapClass} key={`${partId}:gap`}>
                    {highlightSlice(text, gap, gapStart, searchQuery, isActiveMatch)}
                </span>
            ) : null;

            if (part.isWord) {
                return [
                    gapElement,
                    <Word
                        key={partId}
                        word={part.content}
                        original={part.content}
                        lemma={part.lemma}
                        sentenceText={text}
                        sentenceIndex={sentence.index}
                        sentenceHash={textHash}
                        pop={popEle === partId}
                        requestPop={() => onRequestPop(partId)}
                        show={show}
                        alwaysDark={alwaysDark}
                        classNames={wordClassNames}
                        surface={surface}
                    >
                        {highlightSlice(text, part.content, start, searchQuery, isActiveMatch)}
                    </Word>,
                ];
            }
            return [
                gapElement,
                <span className={gapClass} key={partId}>
                    {highlightSlice(text, part.content, start, searchQuery, isActiveMatch)}
                </span>,
            ];
        });

        if (sourceCursor < text.length) {
            rendered.push(
                <span className={gapClass} key={`${textHash}:tail`}>
                    {highlightSlice(text, text.slice(sourceCursor), sourceCursor, searchQuery, isActiveMatch)}
                </span>,
            );
        }
        return rendered;
    }

    // 回退方案：通过标点/空格切词
    const parts = splitWords(text);
    let fallbackCursor = 0;
    return parts.map((w, index) => {
        const partId = `${textHash}:${index}`;
        const wordStart = text.indexOf(w, fallbackCursor);
        const actualStart = wordStart >= fallbackCursor ? wordStart : fallbackCursor;
        fallbackCursor = actualStart + w.length;
        if (isWordToken(w)) {
            const cleaned = cleanWord(w);
            return (
                <Word
                    key={partId}
                    word={w}
                    original={w}
                    lemma={cleaned}
                    sentenceText={text}
                    sentenceIndex={sentence.index}
                    sentenceHash={textHash}
                    pop={popEle === partId}
                    requestPop={() => onRequestPop(partId)}
                    show={show}
                    alwaysDark={alwaysDark}
                    classNames={wordClassNames}
                    surface={surface}
                >
                    {highlightSlice(text, w, actualStart, searchQuery, isActiveMatch)}
                </Word>
            );
        }
        return (
            <span className={gapClass} key={partId}>
                {highlightSlice(text, w, actualStart, searchQuery, isActiveMatch)}
            </span>
        );
    });
}
