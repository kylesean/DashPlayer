import React, { useState } from 'react';
import {
    useFloating,
    autoUpdate,
    offset,
    flip,
    shift,
    useHover,
    useFocus,
    useDismiss,
    useRole,
    useInteractions,
    safePolygon,
} from '@floating-ui/react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import WordPop from './word-pop';
import { playWord, getTtsUrl, playAudioUrl } from '@/fronted/infrastructure/audio/AudioPlayer';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import useSWR from 'swr';
import Style from '@/fronted/styles/style';
import { cn } from '@/fronted/lib/utils';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import Eb from '@/fronted/components/shared/common/Eb';
import { useVocabularyState } from '@/fronted/features/player/vocabularyStore';
import { useShallow } from 'zustand/react/shallow';
import { useTransLineTheme } from './translatable-theme';
import useSetting from '@/fronted/features/settings/settingsStore';
import { usePlayer } from '@/fronted/features/player/playerStore';
import useDictionaryStream, { createDictionaryRequestId } from '@/fronted/features/player/dictionaryStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import {
    VOCABULARY_GUIDANCE_LEVELS,
    type VocabularyGuidance,
    type WordStatus,
} from '@/common/types/vocabulary';
import { resolveVocabularyAnnotation } from '@/fronted/features/player/vocabularyAnnotations';
import { shouldRecordEncounter } from './encounterThrottle';

const logger = getRendererLogger('Word');

/** OpenAI 词典词性到缩写的映射；未知词性保留原文。 */
const PART_OF_SPEECH_ABBR: Record<string, string> = {
    noun: 'n.',
    verb: 'v.',
    adjective: 'adj.',
    adverb: 'adv.',
    preposition: 'prep.',
    conjunction: 'conj.',
    pronoun: 'pron.',
    interjection: 'int.',
    numeral: 'num.',
};

const isOpenAIDictionaryResult = (data: unknown): data is OpenAIDictionaryResult => {
    return typeof data === 'object' && data !== null && 'definitions' in data;
};

/**
 * 从弹窗词典结果中提取简明中文释义。
 *
 * 收藏时把已查到的释义一并传给后端入库，避免后端再调一次词典 AI。
 *
 * @param data 弹窗当前的词典结果（预置词典或 AI 生成）；可能还在加载中或已失败。
 * @returns 可入库的释义文本；提取不到时返回空字符串，由后端自行生成。
 */
const buildFavoriteTranslate = (data: OpenAIDictionaryResult | null | undefined): string => {
    if (!isOpenAIDictionaryResult(data)) {
        return '';
    }
    return data.definitions
        .map((definition) => {
            const abbr = PART_OF_SPEECH_ABBR[definition.partOfSpeech] ?? definition.partOfSpeech;
            return `${abbr} ${definition.meaning}`.trim();
        })
        .filter((entry) => entry.length > 0)
        .join('；');
};

/**
 * 单词组件入参。
 */
export interface WordParam {
    word: string;
    original: string;
    lemma?: string;
    /** 单词所在的整句字幕，供词典引擎做语境消歧；缺失时回退普通词典查询。 */
    sentenceText?: string;
    /** 句子在字幕中的序号，供遭遇事件定位。 */
    sentenceIndex?: number;
    /** 句子内容哈希，供遭遇事件定位。 */
    sentenceHash?: string;
    pop: boolean;
    requestPop: () => void;
    show: boolean;
    alwaysDark?: boolean;
    classNames?: {
        word?: string;    // 单词文本容器（非弹层）
        hover?: string;   // 覆盖 hover 背景
        vocab?: string;   // 覆盖词汇高亮
        vocabFamiliar?: string; // 覆盖「有印象」弱提示
    };
    children?: React.ReactNode;
}

/**
 * 渲染单个字幕原文词，并使用 lemma 判断生词高亮；词典查询仍传递原文。
 * 查词浮层使用 Floating UI (useHover + safePolygon) 统一接管，支持配置化自动暂停与按住 Alt 暂停。
 */
export default function Word({
    word,
    original,
    lemma,
    sentenceText,
    sentenceIndex,
    sentenceHash,
    pop,
    requestPop,
    show,
    alwaysDark = false,
    classNames,
    children,
}: WordParam) {
    const pause = usePlayer((s) => s.pause);
    const {
        isVocabularyWord: checkIsVocab,
        getBaseWord,
        getWordStatus,
        setWordStatus: updateLocalWordStatus,
        removeVocabularyWords,
    } = useVocabularyState(
        useShallow((s) => ({
            isVocabularyWord: s.isVocabularyWord,
            getBaseWord: s.getBaseWord,
            getWordStatus: s.getWordStatus,
            setWordStatus: s.setWordStatus,
            removeVocabularyWords: s.removeVocabularyWords,
            version: s.version,
        })),
    );
    const { t } = useTranslation('common');
    const [isOpen, setIsOpen] = useState(false);
    const [playLoading, setPlayLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [statusSaving, setStatusSaving] = useState(false);
    // 收藏状态：idle 未收藏；saving 提交中；saved 已加入收藏
    const [favoriteState, setFavoriteState] = useState<'idle' | 'saving' | 'saved'>('idle');

    const theme = useTransLineTheme();

    // 检查是否是词汇单词
    const cleanWord = (lemma ?? word).toLowerCase().trim();
    const baseWord = getBaseWord(cleanWord);
    const wordStatus = getWordStatus(cleanWord) ?? (baseWord ? getWordStatus(baseWord) : undefined);
    const isVocabularyWord = cleanWord && checkIsVocab(cleanWord);

    const hoverBg = classNames?.hover ?? (alwaysDark ? 'hover:bg-muted/70' : theme.word.hoverBgClass);
    const guidanceRaw = useSetting((state) => state.values.get('player.vocabularyGuidance'));
    const vocabularyGuidance: VocabularyGuidance = VOCABULARY_GUIDANCE_LEVELS.includes(
        guidanceRaw as VocabularyGuidance,
    )
        ? guidanceRaw as VocabularyGuidance
        : 'calm';
    const annotationKind = resolveVocabularyAnnotation(wordStatus, vocabularyGuidance);
    const vocabCls = annotationKind === 'learning'
        ? (classNames?.vocab ?? theme.word.vocabHighlightClass)
        : annotationKind === 'familiar'
            ? (classNames?.vocabFamiliar ?? theme.word.vocabFamiliarClass)
            : undefined;
    const pauseOnWordHover = useSetting((state) => state.values.get('player.pauseOnWordHover')) === 'true';

    /**
     * 记录一次单词遭遇；失败只写日志，不影响查词/播放主流程。
     */
    const recordEncounter = (action: 'hover' | 'open' | 'save' | 'known' | 'ignore') => {
        if (action === 'open') {
            if (!shouldRecordEncounter('open', cleanWord)) {
                return;
            }
        }
        if (action === 'hover') {
            const hoverKey = `${cleanWord}:${sentenceHash ?? ''}`;
            if (!shouldRecordEncounter('hover', hoverKey)) {
                return;
            }
        }
        const session = usePlaybackSession.getState();
        void videoLearningApi.recordWordEncounter({
            word: cleanWord,
            action,
            videoId: session.videoId ?? undefined,
            fileHash: session.srtHash ?? undefined,
            sentenceIndex,
            sentenceHash,
            context: sentenceText,
        }).catch((error) => {
            logger.error('failed to record word encounter', {
                error: error instanceof Error ? error.message : String(error),
                action,
                word: cleanWord,
            });
        });
    };

    // 订阅流式查词状态；当本词不是活动流时直接忽略
    const dictionaryEntry = useDictionaryStream((state) => state.getActiveEntry(original));

    const shouldFetch = isOpen && pop;

    const {
        data: dictionaryResponse,
        isLoading: isWordLoading,
        mutate: mutateWord,
    } = useSWR(
        shouldFetch ? ['ai-trans/word', original, sentenceText ?? ''] : null,
        async ([_apiName, wordParam, sentenceParam]) => {
            const targetWord = wordParam as string;
            const requestId = createDictionaryRequestId(targetWord);
            useDictionaryStream.getState().startRequest(targetWord, requestId);

            try {
                const result = await playerApi.translateWord({
                    word: targetWord,
                    forceRefresh: false,
                    requestId,
                    context: (sentenceParam as string) || undefined,
                });

                const isOpenAIDictionary = !!result && typeof result === 'object' && 'definitions' in result;
                useDictionaryStream.getState().setFinalResult(
                    targetWord,
                    requestId,
                    isOpenAIDictionary ? result as OpenAIDictionaryResult : null,
                );

                return result;
            } catch (error) {
                useDictionaryStream.getState().setFinalResult(targetWord, requestId, null);
                throw error;
            }
        },
    );

    // Floating UI 浮层与交互配置
    const { refs, floatingStyles, context } = useFloating({
        open: isOpen && pop,
        onOpenChange: (open) => {
            setIsOpen(open);
            if (open) {
                requestPop();
                recordEncounter('open');
            }
        },
        placement: 'bottom-start',
        whileElementsMounted: autoUpdate,
        middleware: [
            offset(6),
            flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
            shift({ padding: 8 }),
        ],
    });

    const hover = useHover(context, {
        // 交互必须始终启用：pop 只有在 requestPop 之后才为 true，
        // 若用 pop 作为启用条件，悬停/点击都无法发起第一次 requestPop（死锁）。
        enabled: true,
        handleClose: safePolygon({ buffer: 2 }),
        restMs: 40,
        delay: { open: 40, close: 140 },
    });
    const focus = useFocus(context, { enabled: true });
    const dismiss = useDismiss(context, { enabled: true });
    const role = useRole(context, { role: 'dialog' });

    const { getReferenceProps, getFloatingProps } = useInteractions([
        hover,
        focus,
        dismiss,
        role,
    ]);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        const requestId = createDictionaryRequestId(original);
        useDictionaryStream.getState().startRequest(original, requestId);

        try {
            const newData = await playerApi.translateWord({
                word: original,
                forceRefresh: true,
                requestId,
                context: sentenceText || undefined,
            });

            const isOpenAIDictionary = !!newData && typeof newData === 'object' && 'definitions' in newData;
            useDictionaryStream.getState().setFinalResult(
                original,
                requestId,
                isOpenAIDictionary ? newData as OpenAIDictionaryResult : null,
            );
            await mutateWord(newData, { revalidate: false });
        } catch (error) {
            useDictionaryStream.getState().setFinalResult(original, requestId, null);
            logger.error('failed to refresh dictionary word', { error: error instanceof Error ? error.message : error });
        } finally {
            setIsRefreshing(false);
        }
    };

    /**
     * 切换生词收藏：未收藏时加入词汇工坊，已收藏时从词表移除。
     */
    const handleFavorite = async () => {
        const favorited = isVocabularyWord || favoriteState === 'saved';
        if (favoriteState === 'saving') {
            return;
        }

        const previousState = favoriteState;
        setFavoriteState('saving');
        try {
            if (favorited) {
                const result = await videoLearningApi.deleteWord(original);
                if (result.success) {
                    const localBase = getBaseWord(cleanWord);
                    removeVocabularyWords([
                        ...(result.data ? [result.data.word] : []),
                        ...(localBase ? [localBase] : [])
                    ]);
                    setFavoriteState('idle');
                    toast.success(t('wordUnfavorited'));
                } else {
                    setFavoriteState(previousState);
                    toast.error(result.error || t('unfavoriteWordFailed'));
                }
                return;
            }

            const result = await videoLearningApi.favoriteWord(original, buildFavoriteTranslate(dictionaryResponse));
            if (result.success && result.data) {
                updateLocalWordStatus(result.data.word, 'learning');
                setFavoriteState('saved');
                recordEncounter('save');
                toast.success(result.data.alreadyExists ? t('wordAlreadyFavorited') : t('wordFavorited'));
            } else {
                setFavoriteState('idle');
                toast.error(result.error || t('favoriteWordFailed'));
            }
        } catch (error) {
            logger.error('failed to toggle favorite word', { error: error instanceof Error ? error.message : error });
            setFavoriteState(previousState);
            toast.error(favorited ? t('unfavoriteWordFailed') : t('favoriteWordFailed'));
        }
    };

    /**
     * 切换「认识 / 忽略 / 回到学习」状态。
     *
     * 同一个动作再点一次会回到 learning，保证误触可逆。
     */
    const handleStatusChange = async (next: WordStatus) => {
        if (statusSaving || !cleanWord) {
            return;
        }
        const target: WordStatus = wordStatus === next ? 'learning' : next;
        setStatusSaving(true);
        try {
            const result = await videoLearningApi.updateWordState(cleanWord, target);
            if (result.success && result.data) {
                updateLocalWordStatus(result.data.word, result.data.status);
                setFavoriteState(target === 'learning' ? 'saved' : 'idle');
                recordEncounter(target === 'known' ? 'known' : target === 'ignored' ? 'ignore' : 'save');
                if (target === 'known') {
                    toast.success(t('wordMarkedKnown'));
                } else if (target === 'ignored') {
                    toast.success(t('wordIgnored'));
                } else {
                    toast.success(t('wordBackToLearning'));
                }
            } else {
                toast.error(result.error || t('wordStateUpdateFailed'));
            }
        } catch (error) {
            logger.error('failed to update word state', { error: error instanceof Error ? error.message : error });
            toast.error(t('wordStateUpdateFailed'));
        } finally {
            setStatusSaving(false);
        }
    };

    /**
     * 判断当前是否存在与该单词相关的有效选区（选中文本时不触发点击发音）。
     */
    const hasMeaningfulSelection = (target: HTMLElement): boolean => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return false;
        }

        return selection.containsNode(target, true);
    };

    /**
     * 单击单词时播放发音。
     */
    const playWordAudio = async () => {
        if (playLoading) return;

        setPlayLoading(true);
        try {
            const ttsUrl = await getTtsUrl(word);
            if (ttsUrl) {
                await playAudioUrl(ttsUrl);
            } else {
                await playWord(word);
            }
        } catch (error) {
            logger.error('failed to play pronunciation', { error: error instanceof Error ? error.message : error });
        } finally {
            setPlayLoading(false);
        }
    };

    const handleWordClick = async (event: React.MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation();
        if (hasMeaningfulSelection(event.currentTarget)) {
            return;
        }
        await playWordAudio();
    };

    const referenceProps = getReferenceProps({
        ref: refs.setReference,
        className: 'rounded cursor-pointer inline',
        role: 'button',
        tabIndex: 0,
        onMouseEnter: (e: React.MouseEvent) => {
            recordEncounter('hover');
            // 用户开启了悬浮暂停设置或正在按住 Alt 时暂停播放
            if (pauseOnWordHover || e.altKey) {
                pause();
            }
        },
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                pause();
                void playWordAudio();
                setIsOpen(true);
                requestPop();
            }
        },
        onClick: (e: React.MouseEvent<HTMLSpanElement>) => {
            pause();
            void handleWordClick(e);
            setIsOpen(true);
            requestPop();
        },
    });

    return (
        <span className="inline" data-word="true">
            <span {...referenceProps} data-word="true">
                <span
                    data-vocab-annotation={annotationKind ?? undefined}
                    className={cn(
                        'rounded select-text transition-all duration-150',
                        !show && ['text-transparent', Style.word_hover_bg],
                        show && hoverBg,
                        show && vocabCls,
                        isOpen && pop && (alwaysDark ? 'bg-accent-muted/20 text-accent font-medium' : theme.word.popReferenceBgClass),
                        classNames?.word,
                    )}
                >
                    {children ?? word}
                </span>
            </span>
            {pop && isOpen ? (
                <Eb>
                    <WordPop
                        translation={dictionaryResponse}
                        setFloatingRef={refs.setFloating}
                        floatingStyles={floatingStyles}
                        getFloatingProps={getFloatingProps}
                        isLoading={isWordLoading || isRefreshing}
                        openaiStreamingData={dictionaryEntry?.data ?? null}
                        isStreaming={!!dictionaryEntry && !dictionaryEntry.isComplete}
                        onRefresh={handleRefresh}
                        onFavorite={handleFavorite}
                        isFavorited={isVocabularyWord || favoriteState === 'saved'}
                        isFavoriting={favoriteState === 'saving'}
                        wordStatus={wordStatus ?? null}
                        isUpdatingStatus={statusSaving}
                        contextWord={original}
                        contextSentence={sentenceText}
                        onMarkKnown={() => { void handleStatusChange('known'); }}
                        onMarkIgnored={() => { void handleStatusChange('ignored'); }}
                    />
                </Eb>
            ) : null}
        </span>
    );
}
