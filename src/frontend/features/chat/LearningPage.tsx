'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { useShallow } from 'zustand/react/shallow';
import useChatPanel from '@/frontend/features/chat/chatStore';
import { chatApi } from '@/frontend/features/chat/chatApi';
import { useSentenceLearningChat } from '@/frontend/features/chat/useSentenceLearningChat';
import { useWhisperDictation } from '@/frontend/features/chat/useWhisperDictation';
import StudyWorkbenchShell from '@/frontend/features/chat/components/StudyWorkbenchShell';
import SentenceStudyCanvas, { type StudyContextNeighbor } from '@/frontend/features/chat/components/SentenceStudyCanvas';
import StudyCopilotPane from '@/frontend/features/chat/components/StudyCopilotPane';
import PromptPresetDialog from '@/frontend/features/chat/components/PromptPresetDialog';
import { usePlayerState } from '@/frontend/features/player/playerState';
import { usePlaybackSession } from '@/frontend/features/player/playbackSessionStore';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import { setPlayerViewMode } from '@/frontend/features/player/lib/player-view-controller';
import usePracticePanel from '@/frontend/features/practice/practiceStore';
import { useVocabularyState } from '@/frontend/features/player/vocabularyStore';
import { useSavedSentences } from '@/frontend/features/context-studio/savedSentencesStore';
import { videoLearningApi } from '@/frontend/features/video-learning/videoLearningApi';
import { getTtsUrl, playAudioUrl } from '@/frontend/infrastructure/audio/AudioPlayer';
import { getRendererLogger } from '@/frontend/log/simple-logger';
import TimeUtil from '@/common/utils/TimeUtil';
import type { SentenceVocabularyVO, SentenceWordEntry } from '@/common/types/vo/SentenceVocabularyVO';

const logger = getRendererLogger('LearningPage');

/**
 * AI-Native 全窗整句精读工作台容器。
 */
export default function LearningPage() {
    const { t } = useTranslation('common');
    const topicText = useChatPanel((state) => state.topicText);
    const topicTranslation = useChatPanel((state) => state.topicTranslation);
    const anchorIndex = useChatPanel((state) => state.anchorIndex);
    const anchorFileHash = useChatPanel((state) => state.anchorFileHash);
    const chatSessionId = useChatPanel((state) => state.chatSessionId);
    const learningVisible = useChatPanel((state) => state.learningVisible);
    const sentenceResolveError = useChatPanel((state) => state.sentenceResolveError);
    const cloudAvailable = useChatPanel((state) => state.cloudAvailable);
    const noteSummary = useChatPanel((state) => state.noteSummary);
    const noteSaving = useChatPanel((state) => state.noteSaving);
    const presets = useChatPanel((state) => state.presets);
    const activePresetId = useChatPanel((state) => state.activePresetId);
    const previewingEvidenceIndex = useChatPanel((state) => state.previewingEvidenceIndex);
    const miniVideoCollapsed = useChatPanel((state) => state.miniVideoCollapsed);

    const sessionScopeKey = `${anchorFileHash ?? ''}:${anchorIndex ?? ''}`;
    const [presetDialogOpen, setPresetDialogOpen] = useState(false);
    const [loopScope, setLoopScope] = useState<string | null>(null);
    const isLooping = learningVisible && loopScope === sessionScopeKey;
    const isLoopingRef = useRef(false);
    const playTokenRef = useRef(0);
    const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const playClipRef = useRef<((target: typeof topicLine) => void) | null>(null);

    const clearLoopTimerAndClip = useCallback(() => {
        isLoopingRef.current = false;
        if (loopTimerRef.current !== null) {
            clearTimeout(loopTimerRef.current);
            loopTimerRef.current = null;
        }
        playTokenRef.current += 1;
        playerActions.clearPracticeClip?.();
    }, []);

    const stopLoopPlayback = useCallback(() => {
        setLoopScope(null);
        clearLoopTimerAndClip();
    }, [clearLoopTimerAndClip]);

    const chat = useSentenceLearningChat();
    const sessionReady = chatSessionId !== '';

    const dictation = useWhisperDictation({
        onTranscriptReady: useCallback((transcript: string) => {
            const current = useChatPanel.getState().input.trim();
            useChatPanel.getState().setInput(current ? `${current} ${transcript}` : transcript);
        }, []),
        onError: useCallback((msg: string) => {
            toast.error(msg);
        }, []),
    });

    // 面板关闭时必须连带清掉 loopScope：只清 ref 不清 scope，重开同一句会让派生
    // isLooping 回到 true，按钮显示"循环中"而实际未在循环。scope 属于渲染期派生状态，
    // 在渲染中就地归零；定时器与播放片段这类外部副作用仍放在 effect 里清理。
    if (!learningVisible && loopScope !== null) {
        setLoopScope(null);
    }
    useEffect(() => {
        if (!learningVisible) {
            clearLoopTimerAndClip();
        }
    }, [learningVisible, clearLoopTimerAndClip]);

    useEffect(() => () => {
        clearLoopTimerAndClip();
    }, [clearLoopTimerAndClip]);

    useEffect(() => {
        if (sentenceResolveError) {
            toast.error(t('learning.sentenceResolveFailed'));
        }
    }, [sentenceResolveError, t]);

    const {
        isVocabularyWord,
        getBaseWord,
        removeVocabularyWords,
        addVocabularyWords,
    } = useVocabularyState(
        useShallow((s) => ({
            isVocabularyWord: s.isVocabularyWord,
            getBaseWord: s.getBaseWord,
            removeVocabularyWords: s.removeVocabularyWords,
            addVocabularyWords: s.addVocabularyWords,
            version: s.version,
        })),
    );
    const sentences = usePlayerState((state) => state.sentences);
    const videoId = usePlaybackSession((state) => state.videoId);
    const trimmedTopic = topicText.trim();

    useEffect(() => {
        if (learningVisible && videoId) {
            void useSavedSentences.getState().loadForVideo(videoId);
        }
    }, [learningVisible, videoId]);

    const [vocabularyState, setVocabularyState] = useState<{
        text: string;
        data: SentenceVocabularyVO | null;
    } | null>(null);
    const sentenceVocabulary = trimmedTopic && vocabularyState?.text === trimmedTopic
        ? vocabularyState.data
        : null;

    const anchorPosition = useMemo(() => {
        if (anchorIndex === null) return -1;
        return sentences.findIndex(
            (s) => s.index === anchorIndex && (!anchorFileHash || s.fileHash === anchorFileHash),
        );
    }, [anchorFileHash, anchorIndex, sentences]);

    const topicLine = anchorPosition >= 0 ? sentences[anchorPosition] : undefined;
    const sentenceKey = topicLine ? `${topicLine.fileHash}:${topicLine.index}` : '';
    const isSentenceSaved = useSavedSentences((state) => (sentenceKey ? state.savedKeys.has(sentenceKey) : false));
    const toggleSavedSentence = useSavedSentences((state) => state.toggleSentence);

    useEffect(() => {
        clearLoopTimerAndClip();
    }, [anchorIndex, anchorFileHash, clearLoopTimerAndClip]);

    const neighbors = useMemo<StudyContextNeighbor[]>(() => {
        if (anchorPosition < 0) return [];
        const start = Math.max(0, anchorPosition - 2);
        const end = Math.min(sentences.length, anchorPosition + 3);
        return sentences.slice(start, end).map((s, idx) => ({
            index: s.index,
            text: s.text,
            isCurrent: start + idx === anchorPosition,
        }));
    }, [anchorPosition, sentences]);

    const sentence = useMemo(() => ({
        en: topicText,
        zh: topicTranslation || topicLine?.textZH || '',
        position: anchorIndex === null
            ? ''
            : [
                topicLine ? TimeUtil.secondToTimeStrCompact(topicLine.start) : '',
                t('learning.position', { index: anchorIndex + 1, total: sentences.length }),
            ].filter(Boolean).join(' · '),
    }), [anchorIndex, sentences.length, t, topicLine, topicText, topicTranslation]);

    useEffect(() => {
        if (!trimmedTopic) return;
        let cancelled = false;
        chatApi.pickSentenceVocabulary(trimmedTopic)
            .then((result) => {
                if (!cancelled) {
                    setVocabularyState({ text: trimmedTopic, data: result });
                }
            })
            .catch((error) => {
                logger.error('failed to pick sentence vocabulary', {
                    error: error instanceof Error ? error.message : error,
                });
                if (!cancelled) {
                    setVocabularyState({ text: trimmedTopic, data: null });
                    toast.error(t('learning.vocabFailed'));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [t, trimmedTopic]);

    const resolveWordDetail = useCallback(
        (word: string): SentenceWordEntry | null => (
            sentenceVocabulary?.details[word]
            ?? sentenceVocabulary?.details[word.toLowerCase()]
            ?? null
        ),
        [sentenceVocabulary],
    );

    const speak = useCallback((text: string) => {
        if (!text.trim()) return;
        getTtsUrl(text)
            .then((url) => playAudioUrl(url))
            .catch((error) => {
                logger.error('failed to speak text', { error: error instanceof Error ? error.message : error });
                toast.error(t('ttsPlayFailed'));
            });
    }, [t]);

    const playClipForSentence = useCallback((target: typeof topicLine) => {
        if (loopTimerRef.current !== null) {
            clearTimeout(loopTimerRef.current);
            loopTimerRef.current = null;
        }
        if (!target) {
            speak(topicText);
            return;
        }
        const range = {
            start: Math.max(0, target.adjustedStart ?? target.start),
            end: Math.max((target.adjustedStart ?? target.start) + 0.4, target.adjustedEnd ?? target.end),
        };
        if (playerActions.playPracticeClip) {
            const token = playTokenRef.current + 1;
            playTokenRef.current = token;
            playerActions.playPracticeClip(range, target, {
                onEnded: () => {
                    if (!isLoopingRef.current || playTokenRef.current !== token) {
                        return;
                    }
                    loopTimerRef.current = setTimeout(() => {
                        if (isLoopingRef.current && playTokenRef.current === token) {
                            playClipRef.current?.(target);
                        }
                    }, 220);
                },
                onAbort: () => {
                    if (playTokenRef.current === token && isLoopingRef.current) {
                        isLoopingRef.current = false;
                        setLoopScope(null);
                    }
                },
            });
            return;
        }
        playerActions.gotoSentence(target);
        playerActions.play();
    }, [speak, topicText]);

    useEffect(() => {
        playClipRef.current = playClipForSentence;
    }, [playClipForSentence]);

    const handlePlayOriginal = useCallback(() => {
        useChatPanel.getState().setPreviewingEvidenceIndex(null);
        playClipForSentence(topicLine);
    }, [playClipForSentence, topicLine]);

    const handleToggleLoop = useCallback(() => {
        if (isLoopingRef.current) {
            stopLoopPlayback();
            return;
        }
        isLoopingRef.current = true;
        setLoopScope(sessionScopeKey);
        useChatPanel.getState().setPreviewingEvidenceIndex(null);
        playClipForSentence(topicLine);
    }, [playClipForSentence, sessionScopeKey, stopLoopPlayback, topicLine]);

    const handleToggleSaveSentence = useCallback(() => {
        if (!topicLine || !sentenceKey) return;
        void toggleSavedSentence({
            sentenceKey,
            videoId: videoId || '',
            fileHash: topicLine.fileHash,
            sentenceIndex: topicLine.index,
            startTime: topicLine.adjustedStart ?? topicLine.start,
            endTime: topicLine.adjustedEnd ?? topicLine.end,
            text: topicLine.text || topicText,
            textZh: sentence.zh,
        }).then((saved) => {
            toast.success(saved ? t('learning.sentenceSavedToStudio') : t('wordUnfavorited'));
        }).catch(() => {
            toast.error(t('favoriteWordFailed'));
        });
    }, [sentence.zh, sentenceKey, t, toggleSavedSentence, topicLine, topicText, videoId]);

    const handlePreviewEvidenceLine = useCallback((targetIndex: number) => {
        const target = sentences.find((s) => s.index === targetIndex);
        if (!target) {
            toast.error(t('learning.evidenceNotFound', { defaultValue: '未找到对应字幕位置' }));
            return;
        }
        useChatPanel.getState().setPreviewingEvidenceIndex(target.index);
        const range = {
            start: Math.max(0, target.start - 0.2),
            end: Math.max(target.start + 3, target.end),
        };
        if (playerActions.playPracticeClip) {
            playerActions.playPracticeClip(range, target);
        } else {
            playerActions.gotoSentence(target);
            playerActions.play();
        }
    }, [sentences, t]);

    const handleReturnToAnchorClip = useCallback(() => {
        useChatPanel.getState().setPreviewingEvidenceIndex(null);
        if (topicLine) {
            playerActions.clearPracticeClip?.();
            playerActions.gotoSentence(topicLine);
        }
    }, [topicLine]);

    const favoriteInFlightRef = useRef<Set<string>>(new Set());

    const toggleFavorite = useCallback(async (word: string, meaning: string) => {
        const key = word.trim().toLowerCase();
        if (!key || favoriteInFlightRef.current.has(key)) {
            return;
        }
        favoriteInFlightRef.current.add(key);
        const favorited = isVocabularyWord(word);
        try {
            if (favorited) {
                const baseWord = getBaseWord(word);
                const result = await videoLearningApi.deleteWord(baseWord ?? word);
                if (!result.success) {
                    toast.error(result.error || t('unfavoriteWordFailed'));
                    return;
                }
                removeVocabularyWords([
                    ...(result.data ? [result.data.word] : []),
                    ...(baseWord ? [baseWord] : []),
                    word,
                ]);
                toast.success(t('wordUnfavorited'));
                return;
            }
            const result = await videoLearningApi.favoriteWord(word, meaning);
            if (!result.success || !result.data) {
                toast.error(result.error || t('favoriteWordFailed'));
                return;
            }
            addVocabularyWords([result.data.word]);
            toast.success(result.data.alreadyExists ? t('wordAlreadyFavorited') : t('wordFavorited'));
        } catch (error) {
            logger.error('failed to toggle favorite word', { error: error instanceof Error ? error.message : error });
            toast.error(favorited ? t('unfavoriteWordFailed') : t('favoriteWordFailed'));
        } finally {
            favoriteInFlightRef.current.delete(key);
        }
    }, [t, isVocabularyWord, getBaseWord, removeVocabularyWords, addVocabularyWords]);

    const isFavorite = useCallback((word: string) => isVocabularyWord(word), [isVocabularyWord]);

    const handleDeepDiveExpression = useCallback((expression: string) => {
        const clean = expression.trim();
        if (!clean) return;
        const store = useChatPanel.getState();
        store.setAttachedFocusExpr(clean);
        if (!chat.isBusy && sessionReady && cloudAvailable) {
            void chat.handleSubmit(`讲讲 "${clean}" 在这句里的画面和地道用法。`);
        }
    }, [chat, cloudAvailable, sessionReady]);

    const handleBackToPlayer = useCallback(() => {
        stopLoopPlayback();
        useChatPanel.getState().hideLearning();
    }, [stopLoopPlayback]);

    const handleJumpToPractice = useCallback(() => {
        stopLoopPlayback();
        if (topicLine) {
            playerActions.gotoSentence(topicLine);
        }
        usePracticePanel.getState().setOpenedFromLearning(true);
        setPlayerViewMode('practice');
    }, [stopLoopPlayback, topicLine]);

    const handleStepSentence = useCallback((delta: -1 | 1) => {
        stopLoopPlayback();
        void useChatPanel.getState().stepSentence(delta);
    }, [stopLoopPlayback]);

    return (
        <div className="h-full w-full select-text">
            <StudyWorkbenchShell
                sentenceIndex={anchorPosition >= 0 ? anchorPosition : anchorIndex}
                totalSentences={sentences.length}
                canStepPrev={anchorPosition > 0}
                canStepNext={anchorPosition >= 0 && anchorPosition < sentences.length - 1}
                onStepSentence={handleStepSentence}
                onBackToPlayer={handleBackToPlayer}
                onJumpToPractice={handleJumpToPractice}
                isSentenceSaved={isSentenceSaved}
                onToggleSaveSentence={handleToggleSaveSentence}
                leftCanvas={(
                    <SentenceStudyCanvas
                        sentence={sentence}
                        neighbors={neighbors}
                        resolveWordDetail={resolveWordDetail}
                        isFavorite={isFavorite}
                        onToggleFavorite={toggleFavorite}
                        onSpeak={speak}
                        onPlayOriginal={handlePlayOriginal}
                        isLooping={isLooping}
                        onToggleLoop={handleToggleLoop}
                        onDeepDiveExpression={handleDeepDiveExpression}
                        onPreviewSubtitleLine={handlePreviewEvidenceLine}
                        miniVideoCollapsed={miniVideoCollapsed}
                        onToggleMiniCollapsed={() => useChatPanel.getState().setMiniVideoCollapsed(!miniVideoCollapsed)}
                        previewingEvidenceIndex={previewingEvidenceIndex}
                        onReturnToAnchorClip={handleReturnToAnchorClip}
                        noteSummary={noteSummary}
                        noteSaving={noteSaving}
                        onNoteChange={(val) => useChatPanel.getState().setNoteSummary(val)}
                        onSaveNote={() => void useChatPanel.getState().saveNoteSummary()}
                    />
                )}
                rightCopilot={(
                    <StudyCopilotPane
                        sentenceText={sentence.en}
                        messages={chat.messageViews}
                        isBusy={chat.isBusy}
                        sessionReady={sessionReady}
                        cloudAvailable={cloudAvailable}
                        chatErrorText={chat.chatErrorText}
                        input={chat.input}
                        onInputChange={chat.setInput}
                        onSubmit={chat.handleSubmit}
                        onStop={chat.stop}
                        onClearConversation={() => useChatPanel.getState().resetConversationView()}
                        onPreviewSubtitleLine={handlePreviewEvidenceLine}
                        onAppendToNote={(snippet) => void useChatPanel.getState().appendToNoteSummary(snippet)}
                        attachedFocusExpr={chat.attachedFocusExpr}
                        onClearFocusExpr={() => chat.setAttachedFocusExpr(null)}
                        onOpenPresetDialog={() => setPresetDialogOpen(true)}
                        dictation={dictation}
                    />
                )}
            />

            <PromptPresetDialog
                isOpen={presetDialogOpen}
                onOpenChange={setPresetDialogOpen}
                presets={presets}
                activePresetId={activePresetId}
                onPresetsUpdated={(next) => useChatPanel.setState({ presets: next })}
                onSelectPreset={(presetId) => void useChatPanel.getState().switchSessionPreset(presetId, true)}
            />
        </div>
    );
}
