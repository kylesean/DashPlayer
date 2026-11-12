/* eslint-disable react-hooks/refs -- Astryx usePopover 把 triggerRef/triggerProps/render 作为渲染期 API 返回，会被 refs 规则误判 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useSWR from 'swr';
import { usePopover } from '@astryxdesign/core/Popover';
import { Button } from '@astryxdesign/core/Button';

import { cn } from '@/fronted/lib/utils';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { useVocabularyStore } from '@/fronted/features/player/vocabularyStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { revalidateReviewQueue } from '@/fronted/features/video-learning/reviewQueue';
import type { ContextReasonCode } from '@/common/types/contextPack';
import { contextPackKey } from '@/fronted/features/player/contextPackKey';
import type { Sentence } from '@/common/types/SentenceC';
import {
    isProactiveGuidance,
    VOCABULARY_GUIDANCE_LEVELS,
    type VocabularyGuidance,
} from '@/common/types/vocabulary';

/**
 * 把后端理由代码映射成当前语言的短文案。
 */
const reasonLabel = (
    reason: ContextReasonCode,
    t: (key: string) => string,
): string => t(`contextSuggestion.reasons.${reason}`);

/**
 * 当前句子的低干扰上下文建议。
 *
 * 只在会主动提示的强度（教练 / 强化）下请求后端；系统建议永远不直接画在
 * 正文上，而是以句子下方的一枚 chip 出现，默认每句最多一个。
 */
export default function ContextSuggestionChip({ sentence }: { sentence: Sentence }) {
    const { t } = useTranslation('player');
    const guidanceRaw = useSetting((state) => state.values.get('player.vocabularyGuidance'));
    const guidance: VocabularyGuidance = VOCABULARY_GUIDANCE_LEVELS.includes(
        guidanceRaw as VocabularyGuidance,
    )
        ? guidanceRaw as VocabularyGuidance
        : 'calm';
    const [dismissedKey, setDismissedKey] = useState<string | null>(null);
    const [openForKey, setOpenForKey] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [ignoring, setIgnoring] = useState(false);
    const displayedRef = useRef(new Set<string>());
    const openedRef = useRef(new Set<string>());

    const proactive = isProactiveGuidance(guidance);
    const sentenceKey = `${sentence.fileHash}:${sentence.index}`;
    // 与词卡共用同一个键：同一句只请求一次，chip 与词卡看到的是同一份候选。
    // 非主动模式不展示建议，key 置空避免默认 calm 下逐句触发完整 ContextPack 计算。
    const swrKey = proactive ? contextPackKey(sentence, guidance) : null;
    const { data } = useSWR(
        swrKey,
        () => videoLearningApi.contextPack({
            text: sentence.text,
            fileHash: sentence.fileHash,
            sentenceIndex: sentence.index,
            guidance,
        }),
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
            dedupingInterval: 0,
        },
    );

    const suggestion = data?.suggestion ?? null;
    const visible = suggestion !== null && dismissedKey !== sentenceKey;
    const open = openForKey === sentenceKey && visible;

    const recordEncounter = useCallback((
        action: 'seen' | 'open' | 'save' | 'ignore',
        word: string,
    ): void => {
        const session = usePlaybackSession.getState();
        void videoLearningApi.recordWordEncounter({
            word,
            action,
            videoId: session.videoId ?? undefined,
            fileHash: sentence.fileHash,
            sentenceIndex: sentence.index,
            sentenceHash: sentenceKey,
            context: sentence.text,
        }).catch(() => undefined);
    }, [sentence.fileHash, sentence.index, sentence.text, sentenceKey]);

    const handleOpenChange = useCallback((next: boolean): void => {
        setOpenForKey(next ? sentenceKey : null);
        if (next && suggestion && !openedRef.current.has(sentenceKey)) {
            openedRef.current.add(sentenceKey);
            recordEncounter('open', suggestion.word);
        }
    }, [recordEncounter, sentenceKey, suggestion]);

    const handlePopoverShow = useCallback(() => handleOpenChange(true), [handleOpenChange]);
    const handlePopoverHide = useCallback(() => handleOpenChange(false), [handleOpenChange]);
    const popover = usePopover({
        className: 'w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-border/60 bg-popover p-3 shadow-lg',
        hasSurface: false,
        isModal: false,
        dialogLabel: suggestion?.word ?? t('contextSuggestion.why'),
        onShow: handlePopoverShow,
        onHide: handlePopoverHide,
    });

    // 外部状态（收藏/忽略/切句/关闭）驱动显隐，与浮层自身的手势关闭保持同步。
    useEffect(() => {
        if (open && !popover.isOpen) {
            popover.show();
        } else if (!open && popover.isOpen) {
            popover.hide();
        }
    }, [open, popover]);

    useEffect(() => {
        if (!proactive || !visible || !suggestion) {
            return;
        }
        if (displayedRef.current.has(sentenceKey)) {
            return;
        }
        displayedRef.current.add(sentenceKey);
        recordEncounter('seen', suggestion.word);
    }, [proactive, recordEncounter, sentenceKey, suggestion, visible]);

    if (!proactive) {
        return null;
    }

    const handleFavorite = async (): Promise<void> => {
        if (!suggestion || saving) {
            return;
        }
        setSaving(true);
        try {
            const result = await videoLearningApi.favoriteWord(
                suggestion.word,
                suggestion.meaning,
            );
            if (!result.success || !result.data) {
                throw new Error(result.error || t('contextSuggestion.favoriteFailed'));
            }
            useVocabularyStore.getState().addVocabularyWords([result.data.word]);
            recordEncounter('save', suggestion.word);
            revalidateReviewQueue();
            toast.success(t('contextSuggestion.favorited'));
            setOpenForKey(null);
            setDismissedKey(sentenceKey);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('contextSuggestion.favoriteFailed')}\n${message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleIgnore = async (): Promise<void> => {
        if (!suggestion || ignoring) {
            return;
        }
        setIgnoring(true);
        try {
            // “先忽略”只作用于当前句的建议，不改变用户词表里的学习状态。
            recordEncounter('ignore', suggestion.word);
            toast.success(t('contextSuggestion.ignored'));
            setOpenForKey(null);
            setDismissedKey(sentenceKey);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('contextSuggestion.ignoreFailed')}\n${message}`);
        } finally {
            setIgnoring(false);
        }
    };

    return (
        <div
            data-testid="context-suggestion-slot"
            className="flex h-7 w-full items-center justify-center"
        >
            {visible ? (
                <>
                    <div
                        className={cn(
                            'inline-flex h-6 max-w-full items-center rounded-full border border-border/50 bg-surface/60',
                            'pl-2 pr-1 text-metadata text-muted-foreground',
                        )}
                    >
                        <button
                            type="button"
                            ref={popover.triggerRef}
                            onClick={popover.toggle}
                            {...popover.triggerProps}
                            data-testid="context-suggestion"
                            className="inline-flex min-w-0 items-center gap-1.5 pr-1.5 cursor-pointer transition-colors hover:text-foreground"
                        >
                            <Lightbulb className="h-3 w-3 shrink-0 text-accent" />
                            <span className="shrink-0 font-medium text-foreground">
                                {suggestion.word}
                            </span>
                            <span className="max-w-[18rem] truncate">
                                {reasonLabel(suggestion.reasons[0] ?? 'useful_new_word', t)}
                            </span>
                        </button>
                        <button
                            type="button"
                            aria-label={t('contextSuggestion.dismiss')}
                            title={t('contextSuggestion.dismiss')}
                            onClick={() => setDismissedKey(sentenceKey)}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground cursor-pointer"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                    {popover.render(
                        <>
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-semibold text-foreground">
                                        {suggestion.word}
                                    </span>
                                    {suggestion.phonetic && (
                                        <span className="text-metadata text-muted-foreground">
                                            {suggestion.phonetic}
                                        </span>
                                    )}
                                </div>
                                {suggestion.tags.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {suggestion.tags.slice(0, 3).map((tag) => (
                                            <span
                                                key={tag}
                                                className="rounded bg-muted/60 px-1 py-0.5 text-[10px] uppercase text-muted-foreground"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <p className="mt-2 text-sm leading-relaxed text-foreground">
                            {suggestion.meaning}
                        </p>

                        <div className="mt-2 rounded-lg bg-muted/30 px-2.5 py-2">
                            <div className="text-metadata font-medium text-muted-foreground">
                                {t('contextSuggestion.why')}
                            </div>
                            <ul className="mt-1 space-y-1">
                                {suggestion.reasons.map((reason) => (
                                    <li
                                        key={reason}
                                        className="flex items-start gap-1.5 text-sm text-foreground"
                                    >
                                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                                        {reasonLabel(reason, t)}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                label={t('contextSuggestion.ignore')}
                                isDisabled={saving}
                                isLoading={ignoring}
                                onClick={() => { void handleIgnore(); }}
                            />
                            {suggestion.isUserWord ? (
                                <span className="inline-flex h-7 items-center rounded-md bg-primary/10 px-2 text-sm font-medium text-primary">
                                    {t('contextSuggestion.alreadyLearning')}
                                </span>
                            ) : (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    label={t('contextSuggestion.favorite')}
                                    isDisabled={ignoring}
                                    isLoading={saving}
                                    onClick={() => { void handleFavorite(); }}
                                />
                            )}
                        </div>
                        </>,
                        { placement: 'above', alignment: 'center', offset: 6 },
                    )}
                </>
            ) : null}
        </div>
    );
}
