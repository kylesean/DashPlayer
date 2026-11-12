import { forwardRef, useState } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Repeat1 } from 'lucide-react';
import type { SentenceBlock } from '@/fronted/features/player/lib/sentence-grouping';
import type { Sentence } from '@/common/types/SentenceC';
import { cn } from '@/fronted/lib/utils';
import TimeUtil from '@/common/utils/TimeUtil';
import useTranslation, { EMPTY_TRANSLATIONS } from '@/fronted/features/player/translationStore';
import { renderSentenceTokens } from '../sentence-token-renderer';
import { highlightSlice } from '../transcript-highlight';
import { SENTENCE_CARD_TESTID } from '@/common/constants/player-scroll-protocol';

export interface ArticleBlockProps {
    /** 意群段落块结构。 */
    block: SentenceBlock;
    /** 当前播放中的句子。 */
    currentSentence: Sentence | null;
    /** 搜索关键字。 */
    searchQuery: string;
    /** 当前选中的搜索匹配项句子下标。 */
    activeMatchedSentenceIndex: number;
    /** 是否展示侧栏译文。 */
    showSideTranslation: boolean;
    /** 字号配置。 */
    fontSize?: string;
    /** 点击句子跳转回调。 */
    onSentenceClick: (sentence: Sentence) => void;
    /** 单句循环开关回调。 */
    onToggleSingleRepeat?: (sentence: Sentence) => void;
    /** 是否处于单句循环状态。 */
    isRepeat?: boolean;
}

interface ArticleSentenceZhSpanProps {
    /** 译文所属句子。 */
    sentence: Sentence;
    /** 是否为当前播放中的句子。 */
    isCurrent: boolean;
    /** 是否为当前选中的搜索匹配项。 */
    isActiveMatch: boolean;
    /** 搜索关键字。 */
    searchQuery: string;
    /** 点击译文跳转回调。 */
    onSentenceClick: (sentence: Sentence) => void;
}

/**
 * 段落内单句中文译文 span：按句订阅自身译文。
 * 任一批译文到达只重渲染对应的句子，而不是整段所有已挂载块。
 */
const ArticleSentenceZhSpan = ({
    sentence,
    isCurrent,
    isActiveMatch,
    searchQuery,
    onSentenceClick,
}: ArticleSentenceZhSpanProps) => {
    const translationKey = sentence.translationKey || '';
    const translation = useTranslation((state) => state.translations.get(translationKey));
    const zhText = sentence.textZH || translation || '';
    if (!zhText) return null;

    return (
        <span
            key={`zh-${sentence.fileHash}:${sentence.index}`}
            role="button"
            tabIndex={0}
            onClick={(e) => {
                const target = e.target as HTMLElement | null;
                if (target?.closest('button')) return;
                onSentenceClick(sentence);
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSentenceClick(sentence);
                }
            }}
            className={cn(
                'inline rounded px-1 py-0.5 mr-1 cursor-pointer transition-colors',
                isCurrent
                    ? 'text-accent font-medium bg-accent-muted/15'
                    : 'text-secondary/70 hover:text-secondary/95',
                isActiveMatch && 'ring-1 ring-amber-500/80 bg-amber-500/15 text-primary',
            )}
        >
            {highlightSlice(zhText, zhText, 0, searchQuery, isActiveMatch)}
        </span>
    );
};

/**
 * 连贯讲稿模式（Flowing Article Mode）下的段落块组件。
 *
 * 将多个连续的字幕句子归纳为一个自然的行文阅读段落：
 * 1. 隐藏多余的每行按键与冗余时间戳，呈现书卷式沉浸连贯排版；
 * 2. 随播放进度流畅流转点亮正在朗读的句子；
 * 3. 完美保留每个英文单词的词典取词、发音与生词收藏能力；
 * 4. 支持整段中英双模对照排版与全局搜索高亮。
 */
const ArticleBlock = forwardRef<HTMLDivElement, ArticleBlockProps>(
    (
        {
            block,
            currentSentence,
            searchQuery,
            activeMatchedSentenceIndex,
            showSideTranslation,
            fontSize,
            onSentenceClick,
            onToggleSingleRepeat,
            isRepeat,
        }: ArticleBlockProps,
        ref,
    ) => {
        const { t } = useI18nTranslation('player');
        const [popEle, setPopEle] = useState<string | null>(null);
        // 仅搜索进行中才订阅整张译文表（段落级「命中才显示译文段」的判定需要）；
        // 平时退化为稳定空引用，译文批次到达不再触发全部已挂载段落重渲染。
        // 各句译文的展示由 ArticleSentenceZhSpan 按句订阅，不受此影响。
        const searchActive = searchQuery.trim() !== '';
        const translations = useTranslation((state) =>
            searchActive ? state.translations : EMPTY_TRANSLATIONS,
        );

        const handleRequestPop = (k: string) => {
            if (popEle !== k) {
                setPopEle(k);
            }
        };

        const hasActiveCurrent = block.sentences.some(
            (s) => !!currentSentence && s.index === currentSentence.index && s.fileHash === currentSentence.fileHash,
        );

        const renderSentenceWords = (sentence: Sentence, _isCurrent: boolean, isActiveMatch: boolean) =>
            renderSentenceTokens({
                sentence,
                text: sentence.text || '',
                searchQuery,
                isActiveMatch,
                popEle,
                onRequestPop: handleRequestPop,
            });

        const timeStr = block.start !== undefined && block.start !== null
            ? TimeUtil.secondToTimeStrCompact(block.start)
            : '';

        return (
            <div
                ref={ref}
                className={cn(
                    'mx-2.5 my-2 px-3.5 py-3 rounded-lg transition-all duration-200 border',
                    hasActiveCurrent
                        ? 'bg-surface/75 border-border/60 shadow-xs'
                        : 'bg-surface/30 hover:bg-surface/50 border-border/25',
                )}
            >
                {/* 段落顶部轻量起始标记 */}
                {timeStr && (
                    <div className="flex items-center gap-1.5 mb-2 pointer-events-none select-none">
                        <span
                            className={cn(
                                'inline-block w-1.5 h-1.5 rounded-full transition-colors',
                                hasActiveCurrent ? 'bg-accent-bg' : 'bg-secondary/40',
                            )}
                        />
                        <span className="text-metadata font-mono text-secondary/60 tracking-tight">
                            {timeStr}
                        </span>
                    </div>
                )}

                {/* 连贯英文字段流 */}
                <div
                    className={cn(
                        'w-full text-left font-sans leading-relaxed tracking-normal select-text break-words transition-colors',
                        fontSize === 'fontSizeSmall' && 'text-side-en-small',
                        (!fontSize || fontSize === 'fontSizeMedium') && 'text-side-en-medium',
                        fontSize === 'fontSizeLarge' && 'text-side-en-large',
                    )}
                >
                    {block.sentences.map((s) => {
                        const isCurrent = !!currentSentence && s.index === currentSentence.index && s.fileHash === currentSentence.fileHash;
                        const isActiveMatch = activeMatchedSentenceIndex === s.index;

                        /**
                         * 句子与「单句循环」按钮必须是兄弟节点。
                         *
                         * 把按钮放进可点击的句子容器里，键盘用户按 Enter 会同时触发
                         * 句子跳转与循环切换（事件冒泡），读屏也会播报两个嵌套的动作目标。
                         * 这里用一层不带交互语义的 inline 包裹，让两者各自独立可聚焦。
                         */
                        return (
                            <span key={`${s.fileHash}:${s.index}`} className="inline">
                                <span
                                    data-testid={SENTENCE_CARD_TESTID}
                                    data-index={s.index}
                                    data-sentence-index={s.index}
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                        const target = e.target as HTMLElement | null;
                                        if (target?.closest('[data-word="true"]')) {
                                            return;
                                        }
                                        onSentenceClick(s);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onSentenceClick(s);
                                        }
                                    }}
                                    className={cn(
                                        'inline rounded-md px-1 py-0.5 cursor-pointer transition-all duration-150',
                                        isCurrent
                                            ? 'bg-accent-bg/20 text-primary font-medium ring-1 ring-accent/35 shadow-xs'
                                            : 'text-secondary hover:text-primary hover:bg-surface/80',
                                        isActiveMatch && 'ring-1 ring-amber-500/80 bg-amber-500/15 text-primary shadow-xs',
                                    )}
                                >
                                    {renderSentenceWords(s, isCurrent, isActiveMatch)}
                                </span>
                                {onToggleSingleRepeat && isCurrent && (
                                    <button
                                        type="button"
                                        onClick={() => onToggleSingleRepeat(s)}
                                        className={cn(
                                            'inline-flex items-center justify-center mx-1 p-0.5 rounded cursor-pointer transition-colors align-middle',
                                            isRepeat
                                                ? 'text-accent bg-accent-bg/25 hover:bg-accent-bg/35'
                                                : 'text-secondary/60 hover:text-primary hover:bg-surface/80',
                                        )}
                                        title={
                                            isRepeat
                                                ? t('sideSentence.cancelSingleLoop', { defaultValue: '关闭单句循环' })
                                                : t('sideSentence.loopSentence', { defaultValue: '开启单句循环' })
                                        }
                                        aria-label={
                                            isRepeat
                                                ? t('sideSentence.cancelSingleLoop', { defaultValue: '关闭单句循环' })
                                                : t('sideSentence.loopSentence', { defaultValue: '开启单句循环' })
                                        }
                                    >
                                        <Repeat1 className="w-2.5 h-2.5" />
                                    </button>
                                )}
                            </span>
                        );
                    })}
                </div>

                {/* 连贯中文译文段落 */}
                {(() => {
                    const hasZhMatch =
                        searchActive &&
                        block.sentences.some((s) => {
                            const trans = s.translationKey ? translations.get(s.translationKey) : '';
                            const q = searchQuery.trim().toLowerCase();
                            return (s.textZH && s.textZH.toLowerCase().includes(q)) || (trans && trans.toLowerCase().includes(q));
                        });
                    const shouldShow = showSideTranslation || hasZhMatch;
                    if (!shouldShow) return null;
                    return (
                        <div
                            className={cn(
                                'w-full text-left leading-relaxed select-text break-words mt-2.5 pt-2 border-t border-border/20 transition-colors',
                                fontSize === 'fontSizeSmall' && 'text-side-zh-small',
                                (!fontSize || fontSize === 'fontSizeMedium') && 'text-side-zh-medium',
                                fontSize === 'fontSizeLarge' && 'text-side-zh-large',
                            )}
                        >
                            {block.sentences.map((s) => {
                                const isCurrent = !!currentSentence && s.index === currentSentence.index && s.fileHash === currentSentence.fileHash;
                                const isActiveMatch = activeMatchedSentenceIndex === s.index;

                                return (
                                    <ArticleSentenceZhSpan
                                        key={`zh-${s.fileHash}:${s.index}`}
                                        sentence={s}
                                        isCurrent={isCurrent}
                                        isActiveMatch={isActiveMatch}
                                        searchQuery={searchQuery}
                                        onSentenceClick={onSentenceClick}
                                    />
                                );
                            })}
                        </div>
                    );
                })()}
            </div>
        );
    },
);

ArticleBlock.displayName = 'ArticleBlock';

export default ArticleBlock;
