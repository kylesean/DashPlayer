import { inject, injectable } from 'inversify';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    analysisStartSchema,
    chatSendMessageSchema,
    chatSessionCloseSchema,
    chatSessionCreateSchema,
    chatSessionStopSchema,
    chatSessionUpdatePresetSchema,
    chatTranscribeAudioSchema,
    completeSentenceSchema,
    learningPromptPresetResetSchema,
    learningPromptPresetSaveSchema,
    sentenceStudyNoteGetSchema,
    sentenceStudyNoteSaveSchema,
} from '@/backend/controllers/ipc/routeSchemas';
import type Controller from '@/backend/controllers/Controller';
import TYPES from '@/backend/ioc/types';
import type ChatSessionService from '@/backend/services/ChatSessionService';
import type {
    ChatSessionCloseParams,
    ChatSessionCreateParams,
    ChatSessionCreateResult,
    ChatSessionStopParams,
    ChatSessionUpdatePresetParams,
    ChatSendMessageParams,
    ChatSendMessageResult,
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
import type SentenceLearningService from '@/backend/services/SentenceLearningService';
import type SentenceStudyNoteRepository from '@/backend/services/repositories/SentenceStudyNoteRepository';
import type LearningPromptPresetService from '@/backend/services/chat/LearningPromptPresetService';
import type SentencePracticeService from '@/backend/services/SentencePracticeService';

/**
 * 整句学习对话、首卡精读、句级笔记与教学预设 IPC 控制器。
 */
@injectable()
export default class ChatStreamController implements Controller {
    constructor(
        @inject(TYPES.ChatSessionService) private readonly chatSessionService: ChatSessionService,
        @inject(TYPES.SentenceLearningService) private readonly sentenceLearningService: SentenceLearningService,
        @inject(TYPES.SentenceStudyNoteRepository) private readonly studyNoteRepository: SentenceStudyNoteRepository,
        @inject(TYPES.LearningPromptPresetService) private readonly promptPresetService: LearningPromptPresetService,
        @inject(TYPES.SentencePracticeService) private readonly sentencePracticeService: SentencePracticeService,
    ) {}

    registerRoutes(): void {
        registerRoute('chat/session/create', async (
            params: ChatSessionCreateParams,
        ): Promise<ChatSessionCreateResult> => {
            return this.chatSessionService.create(params);
        }, { schema: chatSessionCreateSchema });

        registerRoute('chat/session/close', async (params: ChatSessionCloseParams): Promise<void> => {
            this.chatSessionService.close(params.sessionId);
        }, { schema: chatSessionCloseSchema });

        registerRoute('chat/session/stop', async (params: ChatSessionStopParams): Promise<void> => {
            this.chatSessionService.stop(params.sessionId);
        }, { schema: chatSessionStopSchema });

        registerRoute('chat/session/update-preset', async (params: ChatSessionUpdatePresetParams): Promise<void> => {
            this.chatSessionService.updatePreset(params);
        }, { schema: chatSessionUpdatePresetSchema });

        registerRoute('chat/send-message', async (params: ChatSendMessageParams): Promise<ChatSendMessageResult> => {
            return this.chatSessionService.sendMessage(params);
        }, { schema: chatSendMessageSchema });

        registerRoute('chat/analysis/start', async (params: AnalysisStartParams): Promise<AnalysisStartResult> => {
            return this.chatSessionService.startAnalysis(params);
        }, { schema: analysisStartSchema });

        registerRoute('chat/complete-sentence', async (
            params: CompleteSentenceParams,
        ): Promise<CompleteSentenceResult> => {
            return this.sentenceLearningService.completeSentence(params);
        }, { schema: completeSentenceSchema });

        registerRoute('chat/learning/available', async (): Promise<boolean> => {
            return this.sentenceLearningService.isLearningAvailable();
        });

        registerRoute('chat/study-note/get', async (
            params: SentenceStudyNoteGetParams,
        ): Promise<SentenceStudyRecordVO | null> => {
            return this.studyNoteRepository.findByLocation(params.fileHash, params.sentenceIndex);
        }, { schema: sentenceStudyNoteGetSchema });

        registerRoute('chat/study-note/save', async (
            params: SentenceStudyNoteSaveParams,
        ): Promise<SentenceStudyRecordVO> => {
            return this.studyNoteRepository.upsert(params);
        }, { schema: sentenceStudyNoteSaveSchema });

        registerRoute('chat/prompt-presets/list', async (): Promise<LearningPromptPresetVO[]> => {
            return this.promptPresetService.list();
        });

        registerRoute('chat/prompt-presets/save', async (
            params: LearningPromptPresetSaveParams,
        ): Promise<LearningPromptPresetVO> => {
            return this.promptPresetService.save(params);
        }, { schema: learningPromptPresetSaveSchema });

        registerRoute('chat/prompt-presets/reset', async (
            params: LearningPromptPresetResetParams,
        ): Promise<LearningPromptPresetVO> => {
            return this.promptPresetService.resetBuiltin(params);
        }, { schema: learningPromptPresetResetSchema });

        registerRoute('chat/transcribe-audio', async (
            params: ChatTranscribeAudioParams,
        ): Promise<ChatTranscribeAudioResult> => {
            if (params.audio.byteLength < 1024) {
                throw new Error('录音时间过短，请多说几个词再结束录音');
            }
            try {
                const result = await this.sentencePracticeService.transcribeOnce({
                    audio: params.audio,
                    referenceText: '',
                    jobKey: 'chat-dictation',
                });
                return { text: result.transcript.trim() };
            } catch (error) {
                const rawMessage = error instanceof Error ? error.message : String(error);
                // whisper.cpp / parakeet 在无人声或非目标语种时会把上千字符 C++ stderr 拼进异常消息，
                // 聊天框语音听写入口必须拦截并转化为简短可读提示，避免整屏日志弹框。
                if (/未返回识别文本|Segments\s*\(0\)|录音内容为空/i.test(rawMessage)) {
                    if (/parakeet/i.test(rawMessage)) {
                        throw new Error('未识别到清晰英语语音（当前 Parakeet 模型仅支持英文输入；说中文请直接打字或在设置切换语音模型）');
                    }
                    throw new Error('未识别到清晰语音，请靠近麦克风重试');
                }
                throw error instanceof Error ? error : new Error(rawMessage);
            }
        }, { schema: chatTranscribeAudioSchema });
    }
}
