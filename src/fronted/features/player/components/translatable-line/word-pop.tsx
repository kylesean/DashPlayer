import React from 'react';
import { FloatingPortal } from '@floating-ui/react';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import { cn } from '@/fronted/lib/utils';
import OpenAIWordPop from './openai-word-pop';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { useTransLineTheme } from './translatable-theme';
import type { WordStatus } from '@/common/types/vocabulary';
import type { WordMemoryVO } from '@/common/types/wordMemory';

const logger = getRendererLogger('WordPop');

/**
 * 单词释义弹窗入参。
 */
export interface WordSubParam {
    /** 词典查询返回结果。 */
    translation: OpenAIDictionaryResult | null | undefined;
    /** 是否正在加载释义。 */
    isLoading?: boolean;
    /** 流式/最终单词卡数据；预置词典与 AI 生成共用同一结构。 */
    openaiStreamingData?: OpenAIDictionaryResult | null;
    /** 是否处于流式响应接收中。 */
    isStreaming?: boolean;
    /** 刷新重新请求释义的回调。 */
    onRefresh?: () => void;
    /** 点击收藏按钮；未提供时不渲染收藏入口。 */
    onFavorite?: () => void;
    /** 当前单词是否已收藏。 */
    isFavorited?: boolean;
    /** 收藏请求是否进行中。 */
    isFavoriting?: boolean;
    /** 当前单词学习状态。 */
    wordStatus?: WordStatus | null;
    /** 用户点击的单词原文，供语境解读使用。 */
    contextWord?: string;
    /** 浮层的可访问名称（通常为词头）。 */
    dialogLabel?: string;
    /** 单词所在字幕句，供语境解读使用。 */
    contextSentence?: string;
    /** 你与这个词的历史；加载中或不可用时为 null。 */
    wordMemory?: WordMemoryVO | null;
    /** 为什么此刻提示这个词；用户主动查的词通常没有系统理由。 */
    promptReasons?: string[];
    /** 标记为已掌握。 */
    onMarkKnown?: () => void;
    /** 标记为忽略。 */
    onMarkIgnored?: () => void;
    /** 状态更新请求是否进行中。 */
    isUpdatingStatus?: boolean;
    /** 样式覆盖。 */
    classNames?: {
        openaiContainer?: string;
        refreshButton?: string;
    };
    /** Floating UI 浮层样式。 */
    floatingStyles: React.CSSProperties;
    /** Floating UI 交互属性生成函数。 */
    getFloatingProps: (userProps?: React.HTMLProps<HTMLElement>) => Record<string, unknown>;
    /** Floating UI 浮层 DOM 引用设置回调。 */
    setFloatingRef: (node: HTMLElement | null) => void;
}

/**
 * 单词释义浮层容器组件。
 *
 * 依托 FloatingPortal 挂载到 body 根层，由外层 Word 统一驱动 safePolygon 与定位逻辑。
 */
const WordPop: React.FC<WordSubParam> = ({
    translation,
    isLoading: externalIsLoading,
    openaiStreamingData,
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
    dialogLabel,
    contextSentence,
    wordMemory = null,
    promptReasons,
    classNames,
    floatingStyles,
    getFloatingProps,
    setFloatingRef,
}) => {
    logger.debug('WordPop translation data', { translation, openaiStreamingData, isStreaming });

    const theme = useTransLineTheme();
    const cardData = openaiStreamingData ?? (isOpenAIFormat(translation) ? translation : null);

    return (
        <FloatingPortal>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- 浮层容器仅阻止冒泡避免关闭底层取词浮层，交互由内部按钮与文档点击处理 */}
            <div
                {...getFloatingProps({ 'aria-label': dialogLabel ?? cardData?.word ?? undefined })}
                ref={setFloatingRef}
                style={floatingStyles}
                className="z-[9999] outline-none select-none"
                onClick={(e) => {
                    e.stopPropagation();
                }}
            >
                <div className="z-50">
                    <OpenAIWordPop
                        className={cn(theme.pop.openaiContainer, classNames?.openaiContainer)}
                        data={cardData}
                        isLoading={externalIsLoading}
                        isStreaming={isStreaming}
                        onRefresh={onRefresh}
                        onFavorite={onFavorite}
                        isFavorited={isFavorited}
                        isFavoriting={isFavoriting}
                        wordStatus={wordStatus}
                        onMarkKnown={onMarkKnown}
                        onMarkIgnored={onMarkIgnored}
                        isUpdatingStatus={isUpdatingStatus}
                        contextWord={contextWord}
                        contextSentence={contextSentence}
                        wordMemory={wordMemory}
                        promptReasons={promptReasons}
                    />
                </div>
            </div>
        </FloatingPortal>
    );
};

/**
 * 判断数据是否为统一的简化单词卡形状（预置词典与 AI 生成共用）。
 */
const isOpenAIFormat = (data: unknown): data is OpenAIDictionaryResult => {
    return typeof data === 'object' && data !== null && 'definitions' in data && Array.isArray((data as { definitions?: unknown }).definitions);
};

WordPop.displayName = 'WordPop';

export default WordPop;
