import { inject, injectable } from 'inversify';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    analysisStartSchema,
    chatSendMessageSchema,
    chatSessionCloseSchema,
    chatSessionCreateSchema,
    chatSessionStopSchema,
    completeSentenceSchema,
} from '@/backend/controllers/ipc/routeSchemas';
import type Controller from '@/backend/controllers/Controller';
import TYPES from '@/backend/ioc/types';
import type ChatSessionService from '@/backend/services/ChatSessionService';
import type {
    ChatSessionCloseParams,
    ChatSessionCreateParams,
    ChatSessionCreateResult,
    ChatSessionStopParams,
    ChatSendMessageParams,
    ChatSendMessageResult,
    CompleteSentenceParams,
    CompleteSentenceResult,
} from '@/common/types/chat';
import type { AnalysisStartParams, AnalysisStartResult } from '@/common/types/analysis';
import type SentenceLearningService from '@/backend/services/SentenceLearningService';

/**
 * 整句学习对话与句子分析 IPC 控制器。
 */
@injectable()
export default class ChatStreamController implements Controller {
    /**
     * 构造聊天流控制器。
     *
     * @param chatSessionService 整句学习对话会话服务。
     * @param sentenceLearningService 整句学习单次推理服务。
     */
    constructor(
        @inject(TYPES.ChatSessionService) private readonly chatSessionService: ChatSessionService,
        @inject(TYPES.SentenceLearningService) private readonly sentenceLearningService: SentenceLearningService,
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

    }
}
