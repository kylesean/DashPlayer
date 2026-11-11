import React from 'react';
import type { Sentence } from '@/common/types/SentenceC';
import { splitWords, isWordToken, cleanWord } from '@/common/utils/subtitle';
import Word from '@/fronted/features/player/components/translatable-line/word';
import { highlightSlice } from './transcript-highlight';

export interface RenderSentenceTokensOptions {
    sentence: Sentence;
    text: string;
    searchQuery?: string;
    isActiveMatch?: boolean;
    popEle: string | null;
    onRequestPop: (key: string) => void;
}

/**
 * 伴读文稿通用分词与单词交互渲染器。
 *
 * 统一用于单句精析列表（SideSentence）与连贯讲稿流（ArticleBlock），
 * 杜绝近百行分词、词形还原、搜索高亮与词典弹窗绑定逻辑的重复实现。
 */
export function renderSentenceTokens({
    sentence,
    text,
    searchQuery = '',
    isActiveMatch = false,
    popEle,
    onRequestPop,
}: RenderSentenceTokensOptions): React.ReactNode {
    const textHash = `${sentence.fileHash}:${sentence.index}`;

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
                <span className="whitespace-pre-wrap select-text" key={`${partId}:gap`}>
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
                        show={true}
                        alwaysDark={true}
                        classNames={{
                            word: 'px-0.5 rounded text-inherit transition-colors cursor-pointer select-text',
                            hover: 'hover:bg-accent/15 hover:text-accent',
                            vocab: 'underline decoration-accent/70 underline-offset-4 decoration-1 font-medium',
                            vocabFamiliar: 'underline decoration-dotted decoration-accent/45 underline-offset-4 decoration-1',
                        }}
                    >
                        {highlightSlice(text, part.content, start, searchQuery, isActiveMatch)}
                    </Word>,
                ];
            }
            return [
                gapElement,
                <span className="whitespace-pre-wrap select-text" key={partId}>
                    {highlightSlice(text, part.content, start, searchQuery, isActiveMatch)}
                </span>,
            ];
        });

        if (sourceCursor < text.length) {
            rendered.push(
                <span className="whitespace-pre-wrap select-text" key={`${textHash}:tail`}>
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
                    show={true}
                    alwaysDark={true}
                    classNames={{
                        word: 'px-0.5 rounded text-inherit transition-colors cursor-pointer select-text',
                        hover: 'hover:bg-accent/15 hover:text-accent',
                        vocab: 'underline decoration-accent/70 underline-offset-4 decoration-1 font-medium',
                        vocabFamiliar: 'underline decoration-dotted decoration-accent/45 underline-offset-4 decoration-1',
                    }}
                >
                    {highlightSlice(text, w, actualStart, searchQuery, isActiveMatch)}
                </Word>
            );
        }
        return (
            <span className="whitespace-pre-wrap select-text" key={partId}>
                {highlightSlice(text, w, actualStart, searchQuery, isActiveMatch)}
            </span>
        );
    });
}
