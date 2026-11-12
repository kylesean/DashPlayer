'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { useShallow } from 'zustand/react/shallow';
import useChatPanel from '@/fronted/features/chat/chatStore';
import { chatApi } from '@/fronted/features/chat/chatApi';
import { useSentenceLearningChat } from '@/fronted/features/chat/useSentenceLearningChat';
import { useWhisperDictation } from '@/fronted/features/chat/useWhisperDictation';
import StudyWorkbenchShell from '@/fronted/features/chat/components/StudyWorkbenchShell';
import SentenceStudyCanvas, { type StudyContextNeighbor } from '@/fronted/features/chat/components/SentenceStudyCanvas';
import StudyCopilotPane from '@/fronted/features/chat/components/StudyCopilotPane';
import PromptPresetDialog from '@/fronted/features/chat/components/PromptPresetDialog';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import { setPlayerViewMode } from '@/fronted/features/player/lib/player-view-controller';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import { useVocabularyState } from '@/fronted/features/player/vocabularyStore';
import useSetting from '@/fronted/features/settings/settingsStore';
import { videoLearningApi } from '@/fronted/features/video-learning/videoLearningApi';
import { getTtsUrl, playAudioUrl } from '@/fronted/infrastructure/audio/AudioPlayer';
import { getRendererLogger } from '@/fronted/log/simple-logger';
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
    const analysis = useChatPanel((state) => state.analysis);
    const analysisStatus = useChatPanel((state) => state.analysisStatus);
    const analysisError = useChatPanel((state) => state.analysisError);
    const noteSummary = useChatPanel((state) => state.noteSummary);
    const noteSaving = useChatPanel((state) => state.noteSaving);
    const presets = useChatPanel((state) => state.presets);
    const activePresetId = useChatPanel((state) => state.activePresetId);
    const previewingEvidenceIndex = useChatPanel((state) => state.previewingEvidenceIndex);
    const miniVideoCollapsed = useChatPanel((state) => state.miniVideoCollapsed);

    const autoGenerateRaw = useSetting((s) => s.values.get('features.openai.autoGenerateStudyCard'));
    const autoGenerateStudyCard = autoGenerateRaw !== 'false';
    const setSetting = useSetting((s) => s.setSetting);

    const [presetDialogOpen, setPresetDialogOpen] = useState(false);

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

    useEffect(() => {
        if (!learningVisible) {
            playerActions.clearPracticeClip?.();
        }
    }, [learningVisible]);

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
    const trimmedTopic = topicText.trim();

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

    const vocabWords = useMemo(() => sentenceVocabulary?.picks ?? [], [sentenceVocabulary]);

    const resolveWordDetail = useCallback(
        (word: string): SentenceWordEntry | null => sentenceVocabulary?.details[word] ?? null,
        [sentenceVocabulary],
    );

    const speak = useCallback((text: string) => {
        if (!text.trim()) return;
        getTtsUrl(text)
            .then((url) => playAudioUrl(url))
            .catch((error) => {
                logger.error('failed to speak text', { error: error instanceof Error ? error.message : error });
            });
    }, []);

    const playClipForSentence = useCallback((target: typeof topicLine, rate?: number) => {
        if (!target) {
            speak(topicText);
            return;
        }
        const range = {
            start: Math.max(0, target.start),
            end: Math.max(target.start + 0.4, target.end),
        };
        if (playerActions.playPracticeClip) {
            playerActions.playPracticeClip(range, target, rate !== undefined ? { rate } : undefined);
            return;
        }
        playerActions.gotoSentence(target);
        playerActions.play();
    }, [speak, topicText]);

    const handlePlayOriginal = useCallback((rate?: number) => {
        useChatPanel.getState().setPreviewingEvidenceIndex(null);
        playClipForSentence(topicLine, rate);
    }, [playClipForSentence, topicLine]);

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

    const toggleFavorite = useCallback(async (word: string, meaning: string) => {
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
        }
    }, [t, isVocabularyWord, getBaseWord, removeVocabularyWords, addVocabularyWords]);

    const isFavorite = useCallback((word: string) => isVocabularyWord(word), [isVocabularyWord]);

    const requestAnalysis = useCallback(() => {
        void useChatPanel.getState().startAnalysis();
    }, []);

    const stopAnalysis = useCallback(() => {
        void useChatPanel.getState().stopAnalysis();
    }, []);

    const handleDeepDiveExpression = useCallback((expression: string) => {
        const clean = expression.trim();
        if (!clean) return;
        const store = useChatPanel.getState();
        store.setAttachedFocusExpr(clean);
        if (!chat.isBusy && sessionReady && cloudAvailable) {
            void chat.handleSubmit(`用“物理原型画面 → 抽象共识引申 → 这句里的语气”三步帮我讲透 "${clean}"。`);
        }
    }, [chat, cloudAvailable, sessionReady]);

    const handleBackToPlayer = useCallback(() => {
        playerActions.clearPracticeClip?.();
        useChatPanel.getState().hideLearning();
    }, []);

    const handleJumpToPractice = useCallback(() => {
        playerActions.clearPracticeClip?.();
        if (topicLine) {
            playerActions.gotoSentence(topicLine);
        }
        usePracticePanel.getState().setOpenedFromLearning(true);
        setPlayerViewMode('practice');
    }, [topicLine]);

    const handleStepSentence = useCallback((delta: -1 | 1) => {
        playerActions.clearPracticeClip?.();
        void useChatPanel.getState().stepSentence(delta);
    }, []);

    const handleToggleAutoCard = useCallback((checked: boolean) => {
        void setSetting('features.openai.autoGenerateStudyCard', checked ? 'true' : 'false');
    }, [setSetting]);

    const activePresetName = useMemo(() => {
        const found = presets.find((p) => p.id === activePresetId);
        return found?.name ?? t('learning.defaultPresetName', { defaultValue: '物理意象导师' });
    }, [activePresetId, presets, t]);

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
                presets={presets}
                activePresetId={activePresetId}
                onSelectPreset={(presetId) => void useChatPanel.getState().switchSessionPreset(presetId, true)}
                onOpenPresetDialog={() => setPresetDialogOpen(true)}
                autoGenerateStudyCard={autoGenerateStudyCard}
                onToggleAutoGenerateStudyCard={handleToggleAutoCard}
                cloudAvailable={cloudAvailable}
                leftCanvas={(
                    <SentenceStudyCanvas
                        sentence={sentence}
                        neighbors={neighbors}
                        analysis={analysis}
                        analysisStatus={analysisStatus}
                        analysisError={analysisError}
                        sessionReady={sessionReady}
                        cloudAvailable={cloudAvailable}
                        vocabWords={vocabWords}
                        resolveWordDetail={resolveWordDetail}
                        isFavorite={isFavorite}
                        onToggleFavorite={toggleFavorite}
                        onSpeak={speak}
                        onPlayOriginal={handlePlayOriginal}
                        onRequestAnalysis={requestAnalysis}
                        onStopAnalysis={stopAnalysis}
                        onDeepDiveExpression={handleDeepDiveExpression}
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
                        activePresetName={activePresetName}
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
