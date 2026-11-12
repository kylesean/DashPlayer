import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type {
    ChatSessionCreateParams,
    ChatSessionUpdatePresetParams,
    ChatSendMessageParams,
    ChatTranscribeAudioParams,
    ChatTranscribeAudioResult,
    CompleteSentenceParams,
    CompleteSentenceResult,
    LearningPromptPresetResetParams,
    LearningPromptPresetSaveParams,
    LearningPromptPresetVO,
    SentenceStudyNoteGetParams,
    SentenceStudyNoteSaveParams,
    SentenceStudyRecordVO,
} from '@/common/types/chat';
import type { AnalysisStartParams, AnalysisStartResult } from '@/common/types/analysis';

/**
 * 整句学习工作台调用的后端接口。
 */
export const chatApi = {
    createSession: (params: ChatSessionCreateParams) => backendClient.call('chat/session/create', params),

    closeSession: (sessionId: string) => backendClient.call('chat/session/close', { sessionId }),

    stopSession: (sessionId: string) => backendClient.call('chat/session/stop', { sessionId }),

    updateSessionPreset: (params: ChatSessionUpdatePresetParams) =>
        backendClient.call('chat/session/update-preset', params),

    sendMessage: (params: ChatSendMessageParams) => backendClient.call('chat/send-message', params),

    startAnalysis: (params: AnalysisStartParams): Promise<AnalysisStartResult> =>
        backendClient.call('chat/analysis/start', params),

    pickSentenceVocabulary: (text: string) => backendClient.call('vocabulary/pick-sentence', { text }),

    completeSentence: (params: CompleteSentenceParams): Promise<CompleteSentenceResult> =>
        backendClient.call('chat/complete-sentence', params),

    learningAvailable: (): Promise<boolean> => backendClient.call('chat/learning/available'),

    getStudyNote: (params: SentenceStudyNoteGetParams): Promise<SentenceStudyRecordVO | null> =>
        backendClient.call('chat/study-note/get', params),

    saveStudyNote: (params: SentenceStudyNoteSaveParams): Promise<SentenceStudyRecordVO> =>
        backendClient.call('chat/study-note/save', params),

    listPromptPresets: (): Promise<LearningPromptPresetVO[]> =>
        backendClient.call('chat/prompt-presets/list'),

    savePromptPreset: (params: LearningPromptPresetSaveParams): Promise<LearningPromptPresetVO> =>
        backendClient.call('chat/prompt-presets/save', params),

    resetPromptPreset: (params: LearningPromptPresetResetParams): Promise<LearningPromptPresetVO> =>
        backendClient.call('chat/prompt-presets/reset', params),

    transcribeAudio: (params: ChatTranscribeAudioParams): Promise<ChatTranscribeAudioResult> =>
        backendClient.call('chat/transcribe-audio', params),
};
