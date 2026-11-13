import { inject, injectable, optional } from 'inversify';
import { randomUUID } from 'node:crypto';
import {
    APICallError,
    isStepCount,
    type LanguageModel,
    type ModelMessage,
    streamText,
    toUIMessageStream,
    tool,
    type UIMessageChunk,
} from 'ai';
import { z } from 'zod';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import TYPES from '@/backend/ioc/types';
import type AiProviderService from '@/backend/services/AiProviderService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type SentenceLearningService from '@/backend/services/SentenceLearningService';
import { CLOUD_AI_NOT_CONFIGURED_MESSAGE } from '@/backend/services/AiProviderService';
import type {
    ChatSessionCreateParams,
    ChatSessionCreateResult,
    ChatSessionUpdatePresetParams,
    ChatSendMessageParams,
    ChatSendMessageResult,
    GetSubtitleContextResult,
    SearchSubtitlesResult,
    SubtitleSearchHit,
    SubtitleToolLine,
} from '@/common/types/chat';
import { WithRateLimit } from '@/backend/utils/concurrency/decorators';
import { isUserCancellation } from '@/common/utils/cancellation';
import {
    buildSubtitleContext,
    ensureChatRoleMessage,
    splitSystemMessages,
    toLocalChatMessagesWithWindow,
    type SubtitleOverview,
} from '@/backend/services/chat/ChatPromptBuilder';
import type ChatSessionStore from '@/backend/services/chat/ChatSessionStore';
import type { ChatSession } from '@/backend/services/chat/ChatSessionStore';
import type CacheService from '@/backend/services/CacheService';
import type SentenceStudyNoteRepository from '@/backend/services/repositories/SentenceStudyNoteRepository';
import type LearningPromptPresetService from '@/backend/services/chat/LearningPromptPresetService';
import type { LearningMessageBlock } from '@/fronted/features/chat/types';

const describeStreamError = (error: unknown): string => {
    if (error instanceof APICallError) {
        const status = error.statusCode ?? '未知';
        const body = (error.responseBody ?? '').trim();
        const bodyHint = body.length > 0 ? `：${body.slice(0, 200)}` : '';
        const addressHint = error.statusCode === 404
            ? '；接口地址可能不正确或不完整（应包含 /v1 等版本路径），请到「设置 → 服务与资源」检查或使用预设重新填写'
            : '';
        return `云端接口请求失败（HTTP ${status}）${bodyHint}${addressHint}`;
    }
    return error instanceof Error ? error.message : String(error);
};

const isToolsUnsupportedError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return (
        /(?:tools?|function[_\s-]?calling|tool[_\s-]?choice).{0,40}(?:not\s+supported|unsupported|not\s+allowed|disabled|unavailable)/.test(normalized)
        || /(?:does\s+not\s+support|unrecognized|unknown|invalid|unsupported).{0,40}(?:tools?|function[_\s-]?calling|tool[_\s-]?choice)/.test(normalized)
    );
};

/** 从 LanguageModel 提取稳定模型 id 作为降级记忆键；取不到时返回 null（不做记忆）。 */
const resolveToolsUnsupportedKey = (model: LanguageModel): string | null => {
    const modelId = (model as { modelId?: unknown }).modelId;
    return typeof modelId === 'string' && modelId.length > 0 ? modelId : null;
};

export default interface ChatSessionService {
    create(params: ChatSessionCreateParams): ChatSessionCreateResult;
    close(sessionId: string): void;
    stop(sessionId: string): void;
    updatePreset(params: ChatSessionUpdatePresetParams): void;
    sendMessage(params: ChatSendMessageParams): Promise<ChatSendMessageResult>;
}

/**
 * 整句学习对话会话服务实现：
 * 支持云端 / 本地 `llama-server` 双端真流式首卡与对话、动态双层提示词人设及句级 SQLite 记忆落库。
 */
@injectable()
export class ChatSessionServiceImpl implements ChatSessionService {
    private logger = getMainLogger('ChatSessionService');

    constructor(
        @inject(TYPES.AiProviderService) private readonly aiProviderService: AiProviderService,
        @inject(TYPES.LocalAiService) private readonly localAiService: LocalAiService,
        @inject(TYPES.SentenceLearningService) private readonly sentenceLearningService: SentenceLearningService,
        @inject(TYPES.RendererGateway) private readonly rendererGateway: RendererGateway,
        @inject(TYPES.ChatSessionStore) private readonly chatSessionStore: ChatSessionStore,
        @inject(TYPES.CacheService) private readonly cacheService: CacheService,
        @optional() @inject(TYPES.SentenceStudyNoteRepository) private readonly studyNoteRepository?: SentenceStudyNoteRepository,
        @optional() @inject(TYPES.LearningPromptPresetService) private readonly promptPresetService?: LearningPromptPresetService,
    ) {}

    public create(params: ChatSessionCreateParams): ChatSessionCreateResult {
        return { sessionId: this.chatSessionStore.create(params).id };
    }

    public close(sessionId: string): void {
        this.chatSessionStore.close(sessionId);
    }

    public stop(sessionId: string): void {
        this.chatSessionStore.stop(sessionId);
    }

    public updatePreset(params: ChatSessionUpdatePresetParams): void {
        this.chatSessionStore.updatePreset(params.sessionId, {
            presetId: params.presetId,
            customPromptOverride: params.customPromptOverride,
        });
    }

    private resolveCloudModelOrNull(): LanguageModel | null {
        try {
            return this.aiProviderService.getModel('sentenceLearning');
        } catch {
            return null;
        }
    }

    private async resolveSessionPersonaPrompt(session: ChatSession): Promise<string | undefined> {
        if (session.customPromptOverride && session.customPromptOverride.trim().length > 0) {
            return session.customPromptOverride;
        }
        if (this.promptPresetService) {
            const resolved = await this.promptPresetService.resolvePrompt(session.presetId);
            return resolved.rawPrompt;
        }
        return undefined;
    }

    @WithRateLimit('gpt')
    public async sendMessage(
        params: ChatSendMessageParams,
    ): Promise<ChatSendMessageResult> {
        const sessionId = params.sessionId;
        const content = params.content;
        const session = this.chatSessionStore.get(sessionId);
        const model = this.resolveCloudModelOrNull();
        const messageId = this.createMessageId();

        // 首个 await 前原子认领首轮上下文注入权，避免并发 sendMessage 双重注入大段字幕材料。
        const shouldInjectContext = this.chatSessionStore.claimContextInjection(sessionId);
        let localModelId: string | null = null;
        if (!model) {
            try {
                localModelId = await this.sentenceLearningService.resolveLocalModelId();
            } catch (error) {
                if (shouldInjectContext) this.chatSessionStore.releaseContextInjection(sessionId);
                throw error;
            }
            if (!localModelId) {
                if (shouldInjectContext) this.chatSessionStore.releaseContextInjection(sessionId);
                this.rendererGateway.fireAndForget('chat/stream', {
                    sessionId,
                    chunk: { type: 'error', errorText: CLOUD_AI_NOT_CONFIGURED_MESSAGE },
                });
                return { messageId };
            }
        }

        let personaPrompt: string | undefined;
        try {
            personaPrompt = await this.resolveSessionPersonaPrompt(session);
        } catch (error) {
            if (shouldInjectContext) this.chatSessionStore.releaseContextInjection(sessionId);
            throw error;
        }
        const contextText = shouldInjectContext
            ? buildSubtitleContext({
                originalTopic: session.originalTopic,
                paragraphLines: session.paragraphLines,
                subtitleOverview: this.tryGetSubtitleOverview(session.subtitleFileHash, session.anchorSentenceIndex),
            })
            : null;

        const userContent = contextText ? `${contextText}\n\n${content}` : content;
        this.chatSessionStore.appendMessage(sessionId, { role: 'user', content: userContent });
        this.chatSessionStore.appendPersistedMessage(sessionId, {
            id: `user-${messageId}`,
            role: 'user',
            blocks: [{ kind: 'text', text: content }],
            plainText: content,
        });

        const enrichedMessages = ensureChatRoleMessage([...session.messages], {
            personaPrompt,
            enableSubtitleTools: Boolean(model),
        });

        if (!model) {
            this.startTextRunLocal(sessionId, messageId, localModelId as string, enrichedMessages);
            return { messageId };
        }

        this.startTextRun(sessionId, messageId, model, enrichedMessages, personaPrompt);
        return { messageId };
    }

    private startTextRunLocal(
        sessionId: string,
        messageId: string,
        modelId: string,
        messages: ModelMessage[],
    ): void {
        const abortSignal = this.chatSessionStore.startRun(sessionId, messageId);
        this.runTextLocal(sessionId, messageId, modelId, messages, abortSignal)
            .catch((error) => this.handleTextError(sessionId, error))
            .finally(() => this.chatSessionStore.finishRun(sessionId, messageId));
    }

    /**
     * 本地大模型真流式聊天：将结构化历史滑窗裁剪后以 SSE 逐字推给 UIMessageChunk，
     * 并在完成后持久化本轮对话。
     */
    private async runTextLocal(
        sessionId: string,
        messageId: string,
        modelId: string,
        messages: ModelMessage[],
        abortSignal: AbortSignal,
    ): Promise<void> {
        const localMessages = toLocalChatMessagesWithWindow(messages);
        const startedAt = Date.now();
        this.logger.info('chat local stream start', { sessionId, messageId, modelId, turns: localMessages.length });

        const partId = `${messageId}-text`;
        const emit = (chunk: UIMessageChunk) => this.rendererGateway.fireAndForget('chat/stream', { sessionId, chunk });
        let streamStarted = false;
        const ensureTextStarted = () => {
            if (streamStarted) return;
            streamStarted = true;
            emit({ type: 'start', messageId });
            emit({ type: 'text-start', id: partId });
        };

        const content = (await this.localAiService.streamText(
            localMessages,
            modelId,
            {
                onDelta: (delta) => {
                    ensureTextStarted();
                    emit({ type: 'text-delta', id: partId, delta });
                },
            },
            abortSignal,
        )).trim();

        if (!content) {
            throw new Error('本地模型返回了空回复');
        }
        ensureTextStarted();
        emit({ type: 'text-end', id: partId });
        emit({ type: 'finish', finishReason: 'stop' });

        // 停止/关闭发生在流结束与落库之间的窄窗时直接收尾：
        // 对已关闭会话 appendMessage 会抛错，进而被当成非取消错误再向已关会话推 error chunk
        // （云端路径 runStream 有 aborted 守卫，本地路径此前缺这一层）。
        if (abortSignal.aborted) {
            this.logger.info('chat local stream aborted before persist', { sessionId, messageId });
            return;
        }
        this.chatSessionStore.appendMessage(sessionId, { role: 'assistant', content });
        this.chatSessionStore.appendPersistedMessage(sessionId, {
            id: messageId,
            role: 'assistant',
            blocks: [{ kind: 'text', text: content }],
            plainText: content,
        });
        await this.persistSessionMessages(sessionId);

        this.logger.info('chat local stream done', {
            sessionId,
            messageId,
            durationMs: Date.now() - startedAt,
            responseLength: content.length,
        });
    }

    private startTextRun(
        sessionId: string,
        messageId: string,
        model: LanguageModel,
        messages: ModelMessage[],
        personaPrompt?: string,
    ): void {
        const abortSignal = this.chatSessionStore.startRun(sessionId, messageId);
        this.runStream(sessionId, messageId, model, messages, abortSignal, personaPrompt)
            .catch((error) => this.handleTextError(sessionId, error))
            .finally(() => this.chatSessionStore.finishRun(sessionId, messageId));
    }

    private async runStream(
        sessionId: string,
        messageId: string,
        model: LanguageModel,
        messages: ModelMessage[],
        abortSignal: AbortSignal,
        personaPrompt?: string,
        allowTools = true,
        alreadyStarted = false,
    ): Promise<void> {
        // 会话级降级记忆：该模型此前在本会话已确认不支持工具时，直接走无工具路径，
        // 不再重复「带工具请求 → 报错 → 降级」的往返。按 model id 键控，换模型/预设
        // 自动失效重试；正则误报的影响也被限制在单个模型 × 单个会话内。
        const toolsUnsupportedKey = resolveToolsUnsupportedKey(model);
        const effectiveAllowTools = allowTools
            && !(toolsUnsupportedKey && this.chatSessionStore.isToolsUnsupported(sessionId, toolsUnsupportedKey));
        const effectiveMessages = effectiveAllowTools
            ? messages
            : ensureChatRoleMessage(messages, { personaPrompt, enableSubtitleTools: false });
        const { system, messages: promptMessages } = splitSystemMessages(effectiveMessages);
        const startedAt = Date.now();
        this.logger.info('chat stream start', { sessionId, messageId, allowTools: effectiveAllowTools });
        const result = streamText({
            model,
            system,
            messages: promptMessages,
            ...(effectiveAllowTools
                ? {
                    tools: this.buildSubtitleTools(sessionId),
                    stopWhen: isStepCount(20),
                }
                : {}),
            // 关闭 OpenAI Responses 的服务端状态引用（store: false），强制多轮工具调用回传完整 function_call
            // 而非 item_reference，兼容无状态的三方 Open Responses / 代理网关。
            providerOptions: {
                openai: {
                    store: false,
                },
            },
            abortSignal,
            timeout: { firstChunkMs: 30_000, chunkMs: 60_000 },
        });
        let chunkCount = 0;
        let content = '';
        let aborted = false;
        let hasOutput = false;
        let streamStarted = alreadyStarted;
        let shouldFallbackWithoutTools = false;
        const blocks: LearningMessageBlock[] = [];
        const activeToolBlocks = new Map<string, LearningMessageBlock>();

        const uiStream = toUIMessageStream({
            stream: result.stream,
            generateMessageId: () => messageId,
            onError: (error) => describeStreamError(error),
        });

        try {
            for await (const chunk of uiStream) {
                chunkCount += 1;
                if (chunk.type === 'start') {
                    if (streamStarted) continue;
                    streamStarted = true;
                } else if (chunk.type === 'error') {
                    if (effectiveAllowTools && !hasOutput && !abortSignal.aborted && isToolsUnsupportedError(chunk.errorText)) {
                        if (toolsUnsupportedKey) {
                            this.chatSessionStore.markToolsUnsupported(sessionId, toolsUnsupportedKey);
                        }
                        shouldFallbackWithoutTools = true;
                        this.logger.warn('chat stream tools unsupported, falling back without tools', {
                            sessionId,
                            messageId,
                            modelId: toolsUnsupportedKey,
                            reason: chunk.errorText,
                        });
                        break;
                    }
                } else if (chunk.type === 'text-delta') {
                    hasOutput = true;
                    content += chunk.delta;
                    const last = blocks.at(-1);
                    if (last && last.kind === 'text') {
                        last.text += chunk.delta;
                    } else if (chunk.delta.length > 0) {
                        blocks.push({ kind: 'text', text: chunk.delta });
                    }
                } else if (chunk.type === 'tool-input-available') {
                    hasOutput = true;
                    if (chunk.toolName === 'search_subtitles') {
                        const input = chunk.input as { queries?: string[] } | undefined;
                        const block: LearningMessageBlock = {
                            kind: 'search',
                            queries: input?.queries ?? [],
                            hits: [],
                            total: 0,
                            running: true,
                        };
                        activeToolBlocks.set(chunk.toolCallId, block);
                        blocks.push(block);
                    } else if (chunk.toolName === 'get_subtitle_context') {
                        const block: LearningMessageBlock = {
                            kind: 'context',
                            range: null,
                            running: true,
                        };
                        activeToolBlocks.set(chunk.toolCallId, block);
                        blocks.push(block);
                    }
                } else if (chunk.type === 'tool-output-available') {
                    hasOutput = true;
                    const target = activeToolBlocks.get(chunk.toolCallId);
                    if (target?.kind === 'search') {
                        const output = chunk.output as SearchSubtitlesResult | undefined;
                        const hits = output?.matches ?? [];
                        target.hits = hits.map((hit) => ({ index: hit.index, text: hit.text }));
                        target.total = output?.total ?? hits.length;
                        target.running = false;
                    } else if (target?.kind === 'context') {
                        const output = chunk.output as GetSubtitleContextResult | undefined;
                        target.range = output?.startIndex !== undefined && output?.endIndex !== undefined
                            ? { start: output.startIndex, end: output.endIndex }
                            : null;
                        target.running = false;
                    }
                } else if (chunk.type === 'abort') {
                    aborted = true;
                }
                this.rendererGateway.fireAndForget('chat/stream', {
                    sessionId,
                    chunk,
                });
            }
        } catch (error) {
            if (effectiveAllowTools && !hasOutput && !abortSignal.aborted && isToolsUnsupportedError(describeStreamError(error))) {
                if (toolsUnsupportedKey) {
                    this.chatSessionStore.markToolsUnsupported(sessionId, toolsUnsupportedKey);
                }
                shouldFallbackWithoutTools = true;
                this.logger.warn('chat stream tools unsupported (thrown), falling back without tools', {
                    sessionId,
                    messageId,
                    modelId: toolsUnsupportedKey,
                    reason: describeStreamError(error),
                });
            } else {
                throw error;
            }
        }

        if (shouldFallbackWithoutTools) {
            return this.runStream(sessionId, messageId, model, messages, abortSignal, personaPrompt, false, streamStarted);
        }
        if (!aborted) {
            this.chatSessionStore.appendMessage(sessionId, { role: 'assistant', content });
            this.chatSessionStore.appendPersistedMessage(sessionId, {
                id: messageId,
                role: 'assistant',
                blocks: blocks.length > 0 ? blocks : [{ kind: 'text', text: content }],
                plainText: content,
            });
            await this.persistSessionMessages(sessionId);
        }
        this.logger.info('chat stream done', {
            sessionId,
            messageId,
            chunkCount,
            durationMs: Date.now() - startedAt,
            responseLength: content.length,
            aborted,
        });
    }

    private createMessageId(): string {
        return randomUUID();
    }

    private buildSubtitleTools(sessionId: string) {
        const getSentences = () => {
            const session = this.chatSessionStore.get(sessionId);
            const cached = this.cacheService.get('cache:srt', session.subtitleFileHash);
            if (!cached) {
                throw new Error('当前会话的字幕缓存不存在');
            }
            return cached.sentences;
        };

        const projectSentence = (sentence: {
            index: number;
            start: number;
            end: number;
            text: string;
        }): SubtitleToolLine => ({
            index: sentence.index,
            start: sentence.start,
            end: sentence.end,
            text: sentence.text,
        });

        return {
            search_subtitles: tool({
                description: '在当前视频的完整字幕中搜索一个或多个关键词，返回命中字幕的索引、时间和文本。默认任意关键词命中即可；把 context 设为大于 0 可在每个命中行前后各附上若干行连续字幕，一次调用即可看清前后文。',
                inputSchema: z.object({
                    queries: z.preprocess(
                        (val) => {
                            if (typeof val === 'string') {
                                return [val.trim()];
                            }
                            if (Array.isArray(val)) {
                                return val.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
                            }
                            return val;
                        },
                        z.array(z.string().min(1)).min(1)
                    ),
                    match: z.enum(['any', 'all']).default('any'),
                    context: z.number().int().min(0).max(10).default(0),
                    limit: z.number().int().min(1).max(50).default(10),
                    skip: z.number().int().min(0).max(10000).default(0),
                }),
                execute: async ({ queries, match, context, limit, skip }): Promise<SearchSubtitlesResult> => {
                    const sentences = getSentences();
                    const normalizedQueries = queries.map((query) => query.toLowerCase());
                    const matched = sentences
                        .map((sentence, position) => {
                            const text = sentence.text.toLowerCase();
                            const matchedQueries = normalizedQueries.filter((query) => text.includes(query));
                            return matchedQueries.length > 0 && (match === 'any' || matchedQueries.length === normalizedQueries.length)
                                ? { sentence, position, matchedQueries }
                                : null;
                        })
                        .filter((item): item is NonNullable<typeof item> => item !== null);
                    const matches = matched.slice(skip, skip + limit).map(({ sentence, position, matchedQueries }) => {
                        const hit: SubtitleSearchHit = { ...projectSentence(sentence), matchedQueries };
                        if (context > 0) {
                            hit.context = sentences
                                .slice(Math.max(0, position - context), position + context + 1)
                                .map(projectSentence);
                        }
                        return hit;
                    });
                    return {
                        matches,
                        total: matched.length,
                        skip,
                        limit,
                    };
                },
            }),
            get_subtitle_context: tool({
                description: '从指定字幕索引出发，向前 before 行、向后 after 行读取连续字幕；片头/片尾处不足则少给。想继续往后读时，把返回的 endIndex 作为下一次调用的 index。',
                inputSchema: z.object({
                    index: z.number().int().min(0),
                    before: z.number().int().min(0).max(25).default(10),
                    after: z.number().int().min(0).max(25).default(10),
                }),
                execute: async ({ index, before, after }): Promise<GetSubtitleContextResult> => {
                    const sentences = getSentences();
                    const anchorPosition = sentences.findIndex((sentence) => sentence.index === index);
                    if (anchorPosition < 0) {
                        throw new Error(`字幕索引不存在：${index}`);
                    }
                    const start = Math.max(0, anchorPosition - before);
                    const items = sentences.slice(start, anchorPosition + after + 1).map(projectSentence);
                    return {
                        anchorIndex: index,
                        startIndex: items[0]?.index ?? index,
                        endIndex: items.at(-1)?.index ?? index,
                        items,
                    };
                },
            }),
        };
    }

    private tryGetSubtitleOverview(
        subtitleFileHash: string,
        anchorIndex: number,
    ): SubtitleOverview | undefined {
        if (!subtitleFileHash || typeof this.cacheService?.get !== 'function') {
            return undefined;
        }
        const cached = this.cacheService.get('cache:srt', subtitleFileHash);
        if (!cached || cached.sentences.length === 0) {
            return undefined;
        }
        const indexes = cached.sentences.map((sentence) => sentence.index);
        const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
        return {
            lineCount: cached.sentences.length,
            wordCount: cached.sentences.reduce((total, sentence) => total + countWords(sentence.text), 0),
            minIndex: Math.min(...indexes),
            maxIndex: Math.max(...indexes),
            anchorIndex,
        };
    }

    private async persistSessionMessages(sessionId: string): Promise<void> {
        if (!this.studyNoteRepository) return;
        try {
            const session = this.chatSessionStore.get(sessionId);
            if (!session.subtitleFileHash || session.anchorSentenceIndex === undefined) return;
            await this.studyNoteRepository.saveMessages({
                sentenceKey: session.sentenceKey,
                videoId: session.videoId,
                fileHash: session.subtitleFileHash,
                sentenceIndex: session.anchorSentenceIndex,
                originalText: session.originalTopic,
                messages: session.persistedMessages,
                presetId: session.presetId ?? null,
            });
        } catch (error) {
            this.logger.warn('failed to persist sentence chat messages', { sessionId, error });
        }
    }

    private handleTextError(
        sessionId: string,
        error: unknown,
    ): void {
        const cancelled = isUserCancellation(error);
        const errorMessage = describeStreamError(error);
        if (!cancelled) {
            this.logger.error('chat stream failed', { error: errorMessage });
        }
        const chunk: UIMessageChunk = cancelled
            ? { type: 'abort', reason: '用户已取消生成' }
            : { type: 'error', errorText: errorMessage };
        this.rendererGateway.fireAndForget('chat/stream', { sessionId, chunk });
    }
}
