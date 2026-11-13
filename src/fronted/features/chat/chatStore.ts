/**
 * 管理播放器整句学习工作台的会话、首卡精读缓存、教学预设、笔记沉淀与上下文操作。
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { engEqual, p } from '@/common/utils/Util';
import { usePlayer } from '@/fronted/features/player/playerStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { getTtsUrl, playAudioUrl } from '@/fronted/infrastructure/audio/AudioPlayer';
import StrUtil from '@/common/utils/str-util';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { TypeGuards } from '@/common/utils/TypeGuards';
import { chatApi } from '@/fronted/features/chat/chatApi';
import useSetting from '@/fronted/features/settings/settingsStore';
import type { AnalysisStreamEvent, DeepPartial } from '@/common/types/analysis';
import type { SentenceStudyCard } from '@/common/types/aiRes/AiUnifiedAnalysisRes';
import {
    buildSentenceStudyKey,
    type LearningPromptPresetVO,
    type PersistedChatMessage,
} from '@/common/types/chat';
import type { Sentence } from '@/common/types/SentenceC';
import type { SentenceMemoryHints } from '@/common/types/vo/SentenceVocabularyVO';
import { beginOverlayView } from '@/fronted/features/player/lib/player-view-sync';
import usePracticePanel from '@/fronted/features/practice/practiceStore';

const DEFAULT_PRESET_ID = 'image-schema-tutor';

export type ChatPanelState = {
    internal: {
        context: {
            value: string | null;
            time: number;
        };
    };
    chatSessionId: string;
    topicText: string;
    topicTranslation: string;
    queuedMessage: { id: number; sessionId: string; content: string } | null;
    hasLearningContext: boolean;
    learningVisible: boolean;
    sentenceResolveError: string | null;
    cloudAvailable: boolean;
    anchorIndex: number | null;
    anchorFileHash: string | null;
    conversationEpoch: number;
    topicKey: string | null;
    /** 统一精读首卡（SentenceStudyCard）及其流式分片；idle/streaming/done/error/aborted */
    analysis: DeepPartial<SentenceStudyCard> | null;
    analysisMessageId: string | null;
    analysisStatus: 'idle' | 'streaming' | 'done' | 'error' | 'aborted';
    analysisError: string | null;
    /** 个人学习者记忆提示（随本地选词产出，注入后台首卡生成） */
    memoryHints: SentenceMemoryHints | null;
    /** 从 SQLite 恢复的历史对话轮次 */
    restoredMessages: PersistedChatMessage[];
    /** 当前句子的用户学习笔记摘要 */
    noteSummary: string;
    noteSaving: boolean;
    /** 当前活跃教学预设 ID 与全部预设清单 */
    activePresetId: string;
    presets: LearningPromptPresetVO[];
    /** 会话级临时提示词覆盖 */
    customPromptOverride: string | null;
    /** 挂载在 ChatComposerDrawer 中的焦点词/短语 */
    attachedFocusExpr: string | null;
    /** 当前在左上角 PiP 试听的前文证据字幕索引（null = 停留在当前主句） */
    previewingEvidenceIndex: number | null;
    /** 左上角微画中画视频画面是否折叠成极简音频条 */
    miniVideoCollapsed: boolean;
    context: string | null;
    input: string;
};

export type ChatPanelActions = {
    createFromSelect: (text?: string) => Promise<void>;
    createFromCurrent: () => Promise<void>;
    openSentenceSession: (sentence: Sentence, options?: { draftPrompt?: string }) => Promise<void>;
    openFromPracticeIssue: (sentence: Sentence, failedWords: string[]) => Promise<void>;
    stepSentence: (delta: -1 | 1) => Promise<void>;
    toggleLearning: () => Promise<void>;
    hideLearning: () => void;
    clear: () => void;
    resetConversationView: () => void;
    sent: (msg: string) => void;
    receiveAnalysisStream: (event: AnalysisStreamEvent) => void;
    startAnalysis: () => Promise<void>;
    /** 中止当前精读分析流（只停 analysis run，不影响聊天回复流）。 */
    stopAnalysis: () => Promise<void>;
    setNoteSummary: (noteSummary: string) => void;
    saveNoteSummary: (summary?: string) => Promise<void>;
    appendToNoteSummary: (snippet: string) => Promise<void>;
    persistLatestMessages: (messages: PersistedChatMessage[]) => Promise<void>;
    loadPresets: () => Promise<void>;
    switchSessionPreset: (presetId: string, persistDefault?: boolean) => Promise<void>;
    setAttachedFocusExpr: (expr: string | null) => void;
    setPreviewingEvidenceIndex: (index: number | null) => void;
    setMiniVideoCollapsed: (collapsed: boolean) => void;
    updateInternalContext: (value: string) => void;
    ctxMenuOpened: () => void;
    ctxMenuExplain: () => void;
    ctxMenuPlayAudio: () => void;
    ctxMenuPolish: () => void;
    ctxMenuQuote: () => void;
    ctxMenuCopy: () => void;
    setInput: (input: string) => void;
    consumeQueuedMessage: (id: number) => void;
};

const empty = (): ChatPanelState => ({
    internal: {
        context: {
            value: null,
            time: 0,
        },
    },
    chatSessionId: '',
    topicText: '',
    topicTranslation: '',
    queuedMessage: null,
    hasLearningContext: false,
    learningVisible: false,
    sentenceResolveError: null,
    cloudAvailable: false,
    anchorIndex: null,
    anchorFileHash: null,
    conversationEpoch: 0,
    topicKey: null,
    analysis: null,
    analysisMessageId: null,
    analysisStatus: 'idle',
    analysisError: null,
    memoryHints: null,
    restoredMessages: [],
    noteSummary: '',
    noteSaving: false,
    activePresetId: DEFAULT_PRESET_ID,
    presets: [],
    customPromptOverride: null,
    attachedFocusExpr: null,
    previewingEvidenceIndex: null,
    miniVideoCollapsed: false,
    context: null,
    input: '',
});

const chatLogger = getRendererLogger('useChatPanel');

const resolveDefaultPresetId = (): string => {
    try {
        const val = useSetting.getState().setting('learning.activePromptPresetId');
        return val && val.trim().length > 0 ? val.trim() : DEFAULT_PRESET_ID;
    } catch {
        return DEFAULT_PRESET_ID;
    }
};

const enterLearning = () => {
    learningCloseRequested = false;
    usePlayer.getState().pause();
    // 练习面板可见时属于覆盖层叠覆盖层：不重新记录底层视图，避免覆写播客记忆
    beginOverlayView('learning', usePracticePanel.getState().visible);
    useChatPanel.setState({ learningVisible: true });
};

const enterLearningOptimistically = (sentence: Sentence): void => {
    const previousSessionId = useChatPanel.getState().chatSessionId;
    const preservedPresets = useChatPanel.getState().presets;
    const preservedCollapsed = useChatPanel.getState().miniVideoCollapsed;
    if (previousSessionId) {
        chatApi.closeSession(previousSessionId).catch((error) => {
            chatLogger.error('failed to close previous chat session', { error });
        });
    }
    useChatPanel.setState({
        ...empty(),
        presets: preservedPresets,
        miniVideoCollapsed: preservedCollapsed,
        activePresetId: resolveDefaultPresetId(),
        topicText: sentence.text,
        topicTranslation: sentence.textZH ?? '',
        anchorIndex: sentence.index,
        anchorFileHash: sentence.fileHash,
        hasLearningContext: true,
    });
    enterLearning();
};

const isSameLiveTopic = (text: string, anchorIndex: number | null, anchorFileHash: string): boolean => {
    const state = useChatPanel.getState();
    return (
        !!state.chatSessionId
        && state.anchorIndex === anchorIndex
        && state.anchorFileHash === anchorFileHash
        && state.topicKey === text
    );
};

/**
 * 重新打开同一句的学习工作台：保留已生成的首卡、笔记与全部对话历史，直接回到现场。
 */
const reopenLearning = (): void => {
    enterLearning();
    useChatPanel.setState({
        sentenceResolveError: null,
        previewingEvidenceIndex: null,
    });
};

const isCloudLearningAvailable = async (): Promise<boolean> => {
    try {
        return await chatApi.learningAvailable();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        chatLogger.error('读取整句讲解可用性失败，本次按不可用处理', { error: message });
        useChatPanel.setState({ sentenceResolveError: message });
        return false;
    }
};

// 会话创建的在途令牌：每次发起创建都递增代数；旧创建完成时发现令牌易主就丢弃并关闭会话，
// 不再阻塞后续切句/快速重选的并发请求，也不会让 clear() 强行复位后出现双写。
let sessionCreationToken = 0;
let analysisStreamChunkCount = 0;
let analysisStartEpoch = 0;
let learningEntryInFlight = false;
let learningCloseRequested = false;
let learningRequestEpoch = 0;

const startSessionForTopic = async (
    text: string,
    anchor: Sentence,
    topicKey: string,
    translation: string,
    cloudAvailable: boolean,
    options?: {
        expectedEpoch?: number;
        presetId?: string;
        memoryHints?: SentenceMemoryHints | null;
        restoredMessages?: PersistedChatMessage[];
        cachedStudyCard?: SentenceStudyCard | null;
        cachedNoteSummary?: string;
        draftPrompt?: string;
    },
): Promise<string | null> => {
    const expectedEpoch = options?.expectedEpoch ?? learningRequestEpoch;
    const videoId = usePlaybackSession.getState().videoId;
    if (!videoId) {
        throw new Error('当前视频 ID 不存在，无法创建整句学习会话');
    }
    if (expectedEpoch !== learningRequestEpoch) {
        return null;
    }

    const sentences = usePlayer.getState().sentences;
    const anchorPosition = sentences.findIndex(
        (sentence) => sentence.index === anchor.index && sentence.fileHash === anchor.fileHash,
    );
    const paragraphLines = sentences
        .slice(Math.max(0, anchorPosition - 5), Math.min(sentences.length, anchorPosition + 6))
        .filter(TypeGuards.isNotNull)
        .map((sentence) => sentence.text ?? '');

    const creationToken = ++sessionCreationToken;
    const previousSessionId = useChatPanel.getState().chatSessionId;
    if (previousSessionId) {
        chatApi.closeSession(previousSessionId).catch((error) => {
            chatLogger.error('failed to close previous chat session', { error });
        });
    }

    if (!learningCloseRequested) {
        // 学习页已可见或练习面板可见时不重记底层视图（理由同 enterLearning）
        beginOverlayView('learning', useChatPanel.getState().learningVisible || usePracticePanel.getState().visible);
    }

    const activePresetId = options?.presetId || resolveDefaultPresetId();
    const preservedPresets = useChatPanel.getState().presets;
    const preservedCollapsed = useChatPanel.getState().miniVideoCollapsed;

    useChatPanel.setState({
        ...empty(),
        presets: preservedPresets,
        miniVideoCollapsed: preservedCollapsed,
        activePresetId,
        topicText: text,
        topicTranslation: translation,
        topicKey,
        hasLearningContext: true,
        learningVisible: !learningCloseRequested,
        cloudAvailable,
        anchorIndex: anchor.index,
        anchorFileHash: anchor.fileHash,
        memoryHints: options?.memoryHints ?? null,
        restoredMessages: options?.restoredMessages ?? [],
        noteSummary: options?.cachedNoteSummary ?? '',
        analysis: options?.cachedStudyCard ?? null,
        analysisStatus: options?.cachedStudyCard ? 'done' : 'idle',
        input: options?.draftPrompt ?? '',
    });

    const sentenceKey = buildSentenceStudyKey(anchor.fileHash, anchor.index);
    const { sessionId } = await chatApi.createSession({
        videoId,
        originalTopic: text,
        paragraphLines,
        subtitleFileHash: anchor.fileHash,
        anchorSentenceIndex: anchor.index,
        sentenceKey,
        presetId: activePresetId,
        memoryHints: options?.memoryHints ?? undefined,
        restoredMessages: options?.restoredMessages,
    });
    if (
        sessionCreationToken !== creationToken
        || expectedEpoch !== learningRequestEpoch
        || usePlaybackSession.getState().videoId !== videoId
    ) {
        chatApi.closeSession(sessionId).catch((error) => {
            chatLogger.error('failed to close stale chat session', { error });
        });
        return null;
    }
    chatLogger.info('sentence learning session created', {
        sessionId,
        topicLength: text.length,
        paragraphLineCount: paragraphLines.length,
        anchorSentenceIndex: anchor.index,
        restoredCount: options?.restoredMessages?.length ?? 0,
        hasCachedCard: Boolean(options?.cachedStudyCard),
    });

    useChatPanel.setState({ chatSessionId: sessionId });
    if (!learningCloseRequested) {
        usePlayer.getState().pause();
    }
    return sessionId;
};

const useChatPanel = create(
    subscribeWithSelector<ChatPanelState & ChatPanelActions>((set, get) => ({
        ...empty(),
        createFromSelect: async (str?: string) => {
            let text = str;
            if (StrUtil.isBlank(text)) {
                text = p(window.getSelection()?.toString());
                text = text?.replace(/\n/g, '');
                if (StrUtil.isBlank(text)) {
                    text = get().context ?? '';
                }
                if (StrUtil.isBlank(text)) {
                    return;
                }
            }
            const currentSentence = usePlayer.getState().currentSentence;
            if (!currentSentence) {
                throw new Error('当前字幕句不存在，无法创建带上下文工具的整句学习会话');
            }
            if (isSameLiveTopic(text, currentSentence.index, currentSentence.fileHash)) {
                reopenLearning();
                return;
            }
            learningEntryInFlight = true;
            learningCloseRequested = false;
            const requestEpoch = ++learningRequestEpoch;
            try {
                const available = await isCloudLearningAvailable();
                if (requestEpoch !== learningRequestEpoch) {
                    return;
                }
                if (isSameLiveTopic(text, currentSentence.index, currentSentence.fileHash)) {
                    reopenLearning();
                    return;
                }
                await startSessionForTopic(text, currentSentence, text, currentSentence.textZH ?? '', available, {
                    expectedEpoch: requestEpoch,
                });
            } catch (error) {
                if (requestEpoch === learningRequestEpoch) {
                    const message = error instanceof Error ? error.message : String(error);
                    set({ sentenceResolveError: message, learningVisible: false });
                }
                throw error;
            } finally {
                if (requestEpoch === learningRequestEpoch) {
                    learningEntryInFlight = false;
                    if (!useChatPanel.getState().chatSessionId) {
                        const preservedPresets = get().presets;
                        const preservedError = get().sentenceResolveError;
                        const preservedCollapsed = get().miniVideoCollapsed;
                        set({
                            ...empty(),
                            presets: preservedPresets,
                            sentenceResolveError: preservedError,
                            miniVideoCollapsed: preservedCollapsed,
                        });
                    } else if (learningCloseRequested) {
                        learningCloseRequested = false;
                        set({ learningVisible: false });
                    }
                }
            }
        },
        createFromCurrent: async () => {
            const currentSentence = usePlayer.getState().currentSentence;
            if (!currentSentence) {
                return;
            }
            await get().openSentenceSession(currentSentence);
        },
        openSentenceSession: async (sentence: Sentence, options?: { draftPrompt?: string }) => {
            if (isSameLiveTopic(sentence.text, sentence.index, sentence.fileHash)) {
                reopenLearning();
                if (options?.draftPrompt) {
                    set({ input: options.draftPrompt });
                }
                return;
            }
            // 用代数抢占取代「在途即丢弃」：连续切句/选句时最新目标胜出，旧请求在首个异步边界自动退出
            learningEntryInFlight = true;
            learningCloseRequested = false;
            const requestEpoch = ++learningRequestEpoch;
            enterLearningOptimistically(sentence);
            try {
                const [cloudAvailable, studyRecord, pickedVocab] = await Promise.all([
                    isCloudLearningAvailable(),
                    Promise.resolve(chatApi.getStudyNote?.({
                        fileHash: sentence.fileHash,
                        sentenceIndex: sentence.index,
                    })).catch(() => null),
                    Promise.resolve(chatApi.pickSentenceVocabulary?.(sentence.text)).catch(() => null),
                ]);

                if (requestEpoch !== learningRequestEpoch) {
                    return;
                }

                // 进入精读工作台时顺带加载预设列表（非阻塞）
                if (get().presets.length === 0) {
                    void get().loadPresets();
                }

                useChatPanel.setState({ cloudAvailable });

                const cachedCard = studyRecord?.studyCard ?? null;
                const resolvedTopic = cachedCard?.sentence?.completeText?.trim() || sentence.text;
                const resolvedTranslation = cachedCard?.sentence?.contextualTranslation?.trim()
                    || sentence.textZH
                    || '';
                const presetId = studyRecord?.presetId || resolveDefaultPresetId();

                await startSessionForTopic(
                    resolvedTopic,
                    sentence,
                    sentence.text,
                    resolvedTranslation,
                    cloudAvailable,
                    {
                        expectedEpoch: requestEpoch,
                        presetId,
                        memoryHints: pickedVocab?.memoryHints ?? null,
                        restoredMessages: studyRecord?.messages ?? [],
                        cachedStudyCard: cachedCard,
                        cachedNoteSummary: studyRecord?.noteSummary ?? '',
                        draftPrompt: options?.draftPrompt,
                    },
                );
            } catch (error) {
                if (requestEpoch === learningRequestEpoch) {
                    const message = error instanceof Error ? error.message : String(error);
                    set({ sentenceResolveError: message, learningVisible: false });
                }
                throw error;
            } finally {
                if (requestEpoch === learningRequestEpoch) {
                    learningEntryInFlight = false;
                    if (!useChatPanel.getState().chatSessionId) {
                        const preservedPresets = get().presets;
                        const preservedError = get().sentenceResolveError;
                        const preservedCollapsed = get().miniVideoCollapsed;
                        set({
                            ...empty(),
                            presets: preservedPresets,
                            sentenceResolveError: preservedError,
                            miniVideoCollapsed: preservedCollapsed,
                        });
                    } else if (learningCloseRequested) {
                        learningCloseRequested = false;
                        set({ learningVisible: false });
                    }
                }
            }
        },
        openFromPracticeIssue: async (sentence: Sentence, failedWords: string[]) => {
            const uniqueFailed = Array.from(new Set(failedWords.map((w) => w.trim()).filter(Boolean))).slice(0, 4);
            const draftPrompt = uniqueFailed.length > 0
                ? `我在跟读/听写这句时卡在了 ${uniqueFailed.map((w) => `"${w}"`).join('、')}，请结合物理意象和真实连读帮我拆解一下为什么这里总听岔或读不顺？`
                : '我在练习跟读/听写这句时不够顺畅，请帮我拆解这句的节奏重音、连读音变和核心表达画面。';
            await get().openSentenceSession(sentence, { draftPrompt });
        },
        stepSentence: async (delta: -1 | 1) => {
            const { anchorIndex, anchorFileHash } = get();
            const sentences = usePlayer.getState().sentences;
            if (sentences.length === 0) return;
            const currentPos = sentences.findIndex(
                (s) => s.index === anchorIndex && (!anchorFileHash || s.fileHash === anchorFileHash),
            );
            const nextPos = currentPos < 0 ? 0 : currentPos + delta;
            if (nextPos < 0 || nextPos >= sentences.length) return;
            const target = sentences[nextPos];
            if (!target) return;
            // 同步跳转播放器锚点以便左上角 PiP 切到目标句的音画位置
            const gotoFn = usePlayer.getState().gotoSentence;
            if (typeof gotoFn === 'function') {
                gotoFn(target);
            }
            await get().openSentenceSession(target);
        },
        toggleLearning: async () => {
            if (get().learningVisible) {
                get().hideLearning();
                return;
            }
            await get().createFromCurrent();
        },
        hideLearning: () => {
            if (learningEntryInFlight) {
                learningCloseRequested = true;
            }
            set({ learningVisible: false, previewingEvidenceIndex: null });
        },
        clear: () => {
            learningRequestEpoch += 1;
            sessionCreationToken += 1;
            analysisStartEpoch += 1;
            learningEntryInFlight = false;
            learningCloseRequested = false;
            const sessionId = get().chatSessionId;
            if (sessionId) {
                chatApi.closeSession(sessionId).catch((error) => {
                    chatLogger.error('failed to close chat session', { error });
                });
            }
            set(empty());
        },
        resetConversationView: () => {
            set({
                input: '',
                queuedMessage: null,
                restoredMessages: [],
                conversationEpoch: get().conversationEpoch + 1,
            });
        },
        sent: async (msg: string) => {
            const sessionId = get().chatSessionId;
            if (!sessionId || StrUtil.isBlank(msg)) return;
            set({
                queuedMessage: {
                    id: Date.now(),
                    sessionId,
                    content: msg,
                },
            });
        },
        receiveAnalysisStream: (event: AnalysisStreamEvent) => {
            if (event.sessionId !== get().chatSessionId) {
                return;
            }
            if (event.chunk.type === 'start') {
                analysisStreamChunkCount = 0;
                chatLogger.info('analysis stream started in renderer', {
                    sessionId: event.sessionId,
                    messageId: event.chunk.messageId ?? event.messageId,
                });
                set({
                    analysis: {},
                    analysisMessageId: event.chunk.messageId ?? event.messageId,
                    analysisStatus: 'streaming',
                    analysisError: null,
                });
                return;
            }

            if (event.messageId !== get().analysisMessageId) {
                return;
            }

            if (event.chunk.type === 'data-analysis') {
                const partial = event.chunk.data as DeepPartial<SentenceStudyCard>;
                analysisStreamChunkCount += 1;
                if (analysisStreamChunkCount === 1 || analysisStreamChunkCount % 20 === 0) {
                    chatLogger.debug('analysis chunk', {
                        chunkCount: analysisStreamChunkCount,
                        keys: Object.keys(partial ?? {}),
                    });
                }
                const merged = mergeAnalysisPartial(get().analysis ?? {}, partial);
                const completeText = merged.sentence?.completeText?.trim();
                const contextualTranslation = merged.sentence?.contextualTranslation?.trim();
                set({
                    analysis: merged,
                    analysisStatus: 'streaming',
                    ...(completeText ? { topicText: completeText } : {}),
                    ...(contextualTranslation ? { topicTranslation: contextualTranslation } : {}),
                });
                return;
            }
            if (event.chunk.type === 'finish') {
                chatLogger.info('analysis stream finished in renderer', {
                    sessionId: event.sessionId,
                    messageId: event.messageId,
                    chunkCount: analysisStreamChunkCount,
                });
                set({
                    analysisStatus: 'done',
                });
                return;
            }
            if (event.chunk.type === 'error') {
                chatLogger.error('analysis stream failed in renderer', {
                    sessionId: event.sessionId,
                    messageId: event.messageId,
                    errorText: event.chunk.errorText,
                });
                set({
                    analysisStatus: 'error',
                    analysisError: event.chunk.errorText,
                });
                return;
            }
            if (event.chunk.type === 'abort') {
                // 中止进入显式 aborted 态：半成品卡片保留展示（用户看得到已生成的内容），
                // 并提示可重新生成。此前 abort 直接落 idle，半卡与 idle 组合会击穿空态判断，
                // 用户看到残卡却没有任何中止提示。
                set({
                    analysisStatus: 'aborted',
                    analysisMessageId: null,
                });
            }
        },
        startAnalysis: async () => {
            const sessionId = get().chatSessionId;
            if (!sessionId) {
                return;
            }
            // 前端同步占坑去重：避免 startAnalysis await 窗口内重复点击或覆盖已提前抵达的流式 chunk
            if (get().analysisStatus === 'streaming') {
                return;
            }
            const reqEpoch = ++analysisStartEpoch;
            set({
                analysis: {},
                analysisMessageId: null,
                analysisStatus: 'streaming',
                analysisError: null,
            });
            try {
                const { messageId } = await chatApi.startAnalysis({ sessionId });
                if (get().chatSessionId !== sessionId) {
                    return;
                }
                if (reqEpoch !== analysisStartEpoch || get().analysisStatus === 'aborted') {
                    // startAnalysis 仍在途时已被 stopAnalysis/切句中止：补发停流请求，且不再切回 streaming
                    void chatApi.stopAnalysis(sessionId).catch(() => undefined);
                    return;
                }
                // 若 'start'/分片/finish 事件已在 IPC 返回前到达，analysisMessageId 已被流事件设为该 messageId，绝不覆盖
                if (get().analysisMessageId !== messageId) {
                    set({
                        analysisMessageId: messageId,
                        analysisStatus: 'streaming',
                    });
                }
            } catch (error) {
                if (get().chatSessionId !== sessionId || reqEpoch !== analysisStartEpoch) {
                    return;
                }
                const message = error instanceof Error ? error.message : String(error);
                chatLogger.error('failed to start analysis', { sessionId, error: message });
                set({
                    analysis: {},
                    analysisMessageId: null,
                    analysisStatus: 'error',
                    analysisError: message,
                });
            }
        },

        stopAnalysis: async () => {
            const sessionId = get().chatSessionId;
            if (!sessionId || get().analysisStatus !== 'streaming') {
                return;
            }
            analysisStartEpoch += 1;
            // 本地先落 aborted 态（半卡保留展示），后端 abort chunk 会随后到达
            set({ analysisStatus: 'aborted', analysisMessageId: null });
            try {
                await chatApi.stopAnalysis(sessionId);
            } catch (error) {
                chatLogger.warn('failed to stop analysis', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        },
        setNoteSummary: (noteSummary: string) => {
            set({ noteSummary });
        },
        saveNoteSummary: async (summary?: string) => {
            const state = get();
            const videoId = usePlaybackSession.getState().videoId;
            if (!videoId || state.anchorIndex === null || !state.anchorFileHash) return;
            const nextSummary = summary !== undefined ? summary : state.noteSummary;
            set({ noteSaving: true, noteSummary: nextSummary });
            try {
                await chatApi.saveStudyNote({
                    sentenceKey: buildSentenceStudyKey(state.anchorFileHash, state.anchorIndex),
                    videoId,
                    fileHash: state.anchorFileHash,
                    sentenceIndex: state.anchorIndex,
                    originalText: state.topicText,
                    noteSummary: nextSummary,
                    presetId: state.activePresetId,
                });
            } catch (error) {
                chatLogger.error('failed to save sentence study note', { error });
            } finally {
                set({ noteSaving: false });
            }
        },
        appendToNoteSummary: async (snippet: string) => {
            const clean = snippet.trim();
            if (!clean) return;
            const existing = get().noteSummary.trim();
            const next = existing ? `${existing}\n\n${clean}` : clean;
            await get().saveNoteSummary(next);
        },
        persistLatestMessages: async (messages: PersistedChatMessage[]) => {
            const state = get();
            const videoId = usePlaybackSession.getState().videoId;
            if (!videoId || state.anchorIndex === null || !state.anchorFileHash) return;
            set({ restoredMessages: messages });
            try {
                await chatApi.saveStudyNote({
                    sentenceKey: buildSentenceStudyKey(state.anchorFileHash, state.anchorIndex),
                    videoId,
                    fileHash: state.anchorFileHash,
                    sentenceIndex: state.anchorIndex,
                    originalText: state.topicText,
                    messages,
                    presetId: state.activePresetId,
                });
            } catch (error) {
                chatLogger.warn('failed to persist chat messages from renderer', { error });
            }
        },
        loadPresets: async () => {
            try {
                const presets = await chatApi.listPromptPresets?.();
                if (Array.isArray(presets) && presets.length > 0) {
                    set({ presets });
                }
            } catch (error) {
                chatLogger.warn('failed to load learning prompt presets', { error });
            }
        },
        switchSessionPreset: async (presetId: string, persistDefault = true) => {
            const sessionId = get().chatSessionId;
            set({ activePresetId: presetId, customPromptOverride: null });
            if (persistDefault) {
                try {
                    await useSetting.getState().setSetting('learning.activePromptPresetId', presetId);
                } catch (error) {
                    chatLogger.warn('failed to persist active prompt preset setting', { error });
                }
            }
            if (sessionId) {
                await chatApi.updateSessionPreset?.({ sessionId, presetId }).catch((error) => {
                    chatLogger.warn('failed to update session preset', { error });
                });
            }
        },
        setAttachedFocusExpr: (attachedFocusExpr: string | null) => {
            set({ attachedFocusExpr });
        },
        setPreviewingEvidenceIndex: (previewingEvidenceIndex: number | null) => {
            set({ previewingEvidenceIndex });
        },
        setMiniVideoCollapsed: (miniVideoCollapsed: boolean) => {
            set({ miniVideoCollapsed });
        },
        updateInternalContext: (value: string) => {
            get().internal.context.value = value;
            get().internal.context.time = Date.now();
        },
        ctxMenuOpened: () => {
            const internalContext = getInternalContext();
            chatLogger.debug('context menu opened', { context: internalContext });
            set({
                context: internalContext,
            });
        },
        ctxMenuExplain: async () => {
            const userSelect = window.getSelection()?.toString() ?? '';
            if (StrUtil.isBlank(userSelect)) return;
            const context = get().context;
            if (StrUtil.isBlank(context) || engEqual(context, userSelect)) {
                await get().sent(`用物理意象讲透 "${userSelect}" 的本意与用法`);
            } else {
                await get().sent([
                    `结合这句台词，帮我拆解 "${userSelect}" 的物理画面和语境深意：`,
                    '"""',
                    context,
                    '"""',
                ].join('\n'));
            }
        },
        ctxMenuPlayAudio: async () => {
            let text: string | null = window.getSelection()?.toString() ?? '';
            if (StrUtil.isBlank(text)) {
                text = get().context;
            }
            if (StrUtil.isBlank(text)) return;
            const ttsUrl = await getTtsUrl(text);
            await playAudioUrl(ttsUrl);
        },
        ctxMenuPolish: async () => {
            let text = window.getSelection()?.toString() ?? '';
            if (StrUtil.isBlank(text)) {
                text = get().context ?? '';
            }
            if (StrUtil.isBlank(text)) return;
            await get().sent(`帮我把这句话按母语者的习惯给出 2 个地道改写（附上语感差异）：\n"""\n${text}\n"""`);
        },
        ctxMenuQuote: () => {
            let text: string | null = window.getSelection()?.toString() ?? '';
            if (StrUtil.isBlank(text)) {
                text = get().context;
            }
            if (StrUtil.isBlank(text)) return;
            text = `<context>\n${text.trim()}\n</context>\n\n`;
            if (StrUtil.isNotBlank(get().input)) {
                text = `${get().input}\n${text}`;
            }
            set({ input: text });
        },
        ctxMenuCopy: async () => {
            let text: string | null = window.getSelection()?.toString() ?? '';
            if (StrUtil.isBlank(text)) {
                text = get().context;
            }
            if (StrUtil.isBlank(text)) return;
            await navigator.clipboard.writeText(text);
        },
        setInput: (input: string) => {
            set({ input });
        },
        consumeQueuedMessage: (id: number) => {
            if (get().queuedMessage?.id === id) {
                set({ queuedMessage: null });
            }
        },
    })),
);

export function getInternalContext(): string | null {
    const context = useChatPanel.getState().internal.context;
    if (!context) return null;
    if (Math.abs(Date.now() - context.time) > 500) {
        return null;
    }
    return context.value;
}

const mergeAnalysisPartial = (
    current: DeepPartial<SentenceStudyCard>,
    partial: DeepPartial<SentenceStudyCard>,
): DeepPartial<SentenceStudyCard> => {
    const mergeValue = (base: unknown, update: unknown): unknown => {
        if (Array.isArray(base) || Array.isArray(update)) {
            const baseArr = Array.isArray(base) ? base : [];
            const updateArr = Array.isArray(update) ? update : [];
            const length = Math.max(baseArr.length, updateArr.length);
            return Array.from({ length }).map((_, index) => {
                if (index in updateArr) {
                    return mergeValue(baseArr[index], updateArr[index]);
                }
                return baseArr[index];
            });
        }
        if (base && typeof base === 'object' && update && typeof update === 'object') {
            const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
            Object.entries(update as Record<string, unknown>).forEach(([key, value]) => {
                result[key] = mergeValue(result[key], value);
            });
            return result;
        }
        if (update !== undefined) {
            return update;
        }
        return base;
    };

    return mergeValue(current, partial) as DeepPartial<SentenceStudyCard>;
};

export default useChatPanel;
