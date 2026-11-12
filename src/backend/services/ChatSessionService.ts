import { inject, injectable, optional } from 'inversify';
import { randomUUID } from 'node:crypto';
import {
    APICallError,
    isStepCount,
    type LanguageModel,
    type ModelMessage,
    Output,
    parsePartialJson,
    streamText,
    toUIMessageStream,
    tool,
    type UIMessageChunk,
} from 'ai';
import { z } from 'zod';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { parseMaybeJson } from '@/common/utils/ai/parseMaybeJson';
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
import type { AnalysisStartParams, AnalysisStartResult } from '@/common/types/analysis';
import {
    SentenceStudyCardSchema,
    type SentenceStudyCard,
} from '@/common/types/aiRes/AiUnifiedAnalysisRes';
import { WithRateLimit } from '@/backend/utils/concurrency/decorators';
import { isUserCancellation } from '@/common/utils/cancellation';
import {
    buildStudyCardPrompt,
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

/** 本地流式首卡增量 JSON 尝试解析的最小时间间隔，避免高频反序列化抖动。 */
const LOCAL_PARTIAL_EMIT_INTERVAL_MS = 120;

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

export default interface ChatSessionService {
    create(params: ChatSessionCreateParams): ChatSessionCreateResult;
    close(sessionId: string): void;
    stop(sessionId: string): void;
    updatePreset(params: ChatSessionUpdatePresetParams): void;
    sendMessage(params: ChatSendMessageParams): Promise<ChatSendMessageResult>;
    startAnalysis(params: AnalysisStartParams): Promise<AnalysisStartResult>;
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
    public async startAnalysis(params: AnalysisStartParams): Promise<AnalysisStartResult> {
        const sessionId = params.sessionId;
        const session = this.chatSessionStore.get(sessionId);
        const model = this.resolveCloudModelOrNull();
        let localModelId: string | null = null;
        if (!model) {
            localModelId = await this.sentenceLearningService.resolveLocalModelId();
            if (!localModelId) {
                throw new Error(CLOUD_AI_NOT_CONFIGURED_MESSAGE);
            }
        }

        const personaPrompt = await this.resolveSessionPersonaPrompt(session);
        const messageId = this.createMessageId();
        const prompt = buildStudyCardPrompt({
            text: session.originalTopic,
            paragraphLines: session.paragraphLines,
            subtitleOverview: this.tryGetSubtitleOverview(session.subtitleFileHash, session.anchorSentenceIndex),
            memoryHints: session.memoryHints,
            personaPrompt,
        });

        const abortSignal = this.chatSessionStore.startRun(sessionId, messageId);
        this.rendererGateway.fireAndForget('chat/analysis/stream', {
            sessionId,
            messageId,
            chunk: { type: 'start', messageId },
        });
        if (model) {
            this.runAnalysisStream(sessionId, messageId, model, prompt, abortSignal)
                .catch((error) => this.handleAnalysisError(sessionId, messageId, error))
                .finally(() => this.chatSessionStore.finishRun(sessionId, messageId));
        } else {
            this.runAnalysisLocal(sessionId, messageId, localModelId as string, prompt, abortSignal)
                .catch((error) => this.handleAnalysisError(sessionId, messageId, error))
                .finally(() => this.chatSessionStore.finishRun(sessionId, messageId));
        }

        return { messageId };
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

        let localModelId: string | null = null;
        if (!model) {
            localModelId = await this.sentenceLearningService.resolveLocalModelId();
            if (!localModelId) {
                this.rendererGateway.fireAndForget('chat/stream', {
                    sessionId,
                    chunk: { type: 'error', errorText: CLOUD_AI_NOT_CONFIGURED_MESSAGE },
                });
                return { messageId };
            }
        }

        const personaPrompt = await this.resolveSessionPersonaPrompt(session);
        const contextText = !session.contextInjected
            ? buildSubtitleContext({
                originalTopic: session.originalTopic,
                paragraphLines: session.paragraphLines,
                subtitleOverview: this.tryGetSubtitleOverview(session.subtitleFileHash, session.anchorSentenceIndex),
            })
            : null;
        if (!session.contextInjected) {
            this.chatSessionStore.markContextInjected(sessionId);
        }

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

        this.startTextRun(sessionId, messageId, model, enrichedMessages);
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
    ): void {
        const abortSignal = this.chatSessionStore.startRun(sessionId, messageId);
        this.runStream(sessionId, messageId, model, messages, abortSignal)
            .catch((error) => this.handleTextError(sessionId, error))
            .finally(() => this.chatSessionStore.finishRun(sessionId, messageId));
    }

    private async runStream(
        sessionId: string,
        messageId: string,
        model: LanguageModel,
        messages: ModelMessage[],
        abortSignal: AbortSignal,
    ): Promise<void> {
        const { system, messages: promptMessages } = splitSystemMessages(messages);
        const startedAt = Date.now();
        this.logger.info('chat stream start', { sessionId, messageId });
        const result = streamText({
            model,
            system,
            messages: promptMessages,
            tools: this.buildSubtitleTools(sessionId),
            stopWhen: isStepCount(20),
            abortSignal,
            timeout: { firstChunkMs: 30_000, chunkMs: 60_000 },
        });
        let chunkCount = 0;
        let content = '';
        let aborted = false;
        const blocks: LearningMessageBlock[] = [];
        const activeToolBlocks = new Map<string, LearningMessageBlock>();

        const uiStream = toUIMessageStream({
            stream: result.stream,
            generateMessageId: () => messageId,
            onError: (error) => error instanceof Error ? error.message : String(error),
        });

        for await (const chunk of uiStream) {
            chunkCount += 1;
            if (chunk.type === 'text-delta') {
                content += chunk.delta;
                const last = blocks.at(-1);
                if (last && last.kind === 'text') {
                    last.text += chunk.delta;
                } else if (chunk.delta.length > 0) {
                    blocks.push({ kind: 'text', text: chunk.delta });
                }
            } else if (chunk.type === 'tool-input-available') {
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

    /**
     * 本地大模型真流式生成统一精读首卡（SentenceStudyCardSchema）：
     * 消费 llama-server SSE JSON token，节流增量解析部分对象实时回推 `data-analysis`，
     * 并在收尾后自动写入 SQLite 句级缓存。
     */
    private async runAnalysisLocal(
        sessionId: string,
        messageId: string,
        modelId: string,
        prompt: string,
        abortSignal: AbortSignal,
    ): Promise<void> {
        const startedAt = Date.now();
        this.logger.info('analysis local stream start', { sessionId, messageId, modelId });

        let accumulated = '';
        let lastPartialEmitAt = 0;

        const output = await this.localAiService.streamText(
            prompt,
            modelId,
            {
                onDelta: (delta) => {
                    accumulated += delta;
                    const now = Date.now();
                    if (now - lastPartialEmitAt < LOCAL_PARTIAL_EMIT_INTERVAL_MS) {
                        return;
                    }
                    lastPartialEmitAt = now;
                    void parsePartialJson(accumulated).then((parsed) => {
                        if (parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
                            this.rendererGateway.fireAndForget('chat/analysis/stream', {
                                sessionId,
                                messageId,
                                chunk: { type: 'data-analysis', id: messageId, data: parsed.value },
                            });
                        }
                    }).catch(() => undefined);
                },
            },
            abortSignal,
            {
                schema: z.toJSONSchema(SentenceStudyCardSchema),
                temperature: 0.4,
            },
        );

        const parsed = SentenceStudyCardSchema.safeParse(parseMaybeJson(output));
        if (!parsed.success) {
            this.logger.error('analysis local 结构无效', {
                modelId,
                rawText: output.slice(0, 500),
                issues: parsed.error.issues,
            });
            throw new Error('本地模型分析输出不符合契约');
        }

        await this.persistStudyCard(sessionId, parsed.data);
        this.logger.info('analysis local stream done', { sessionId, messageId, durationMs: Date.now() - startedAt });
        this.rendererGateway.fireAndForget('chat/analysis/stream', {
            sessionId,
            messageId,
            chunk: { type: 'data-analysis', id: messageId, data: parsed.data },
        });
        this.rendererGateway.fireAndForget('chat/analysis/stream', {
            sessionId,
            messageId,
            chunk: { type: 'finish', finishReason: 'stop' },
        });
    }

    private async runAnalysisStream(
        sessionId: string,
        messageId: string,
        model: LanguageModel,
        prompt: string,
        abortSignal: AbortSignal,
    ): Promise<void> {
        const startedAt = Date.now();
        this.logger.info('analysis stream start', { sessionId, messageId });
        const result = streamText({
            model,
            output: Output.object({ schema: SentenceStudyCardSchema }),
            prompt,
            abortSignal,
            timeout: { firstChunkMs: 30_000, chunkMs: 60_000 },
        });
        let chunkCount = 0;
        for await (const partial of result.partialOutputStream) {
            chunkCount += 1;
            if (chunkCount === 1 || chunkCount % 20 === 0) {
                this.logger.debug('analysis stream chunk', {
                    sessionId,
                    messageId,
                    chunkCount,
                    keys: Object.keys(partial ?? {}),
                });
            }
            this.rendererGateway.fireAndForget('chat/analysis/stream', {
                sessionId,
                messageId,
                chunk: {
                    type: 'data-analysis',
                    id: messageId,
                    data: partial,
                },
            });
        }
        const finalObject = await result.output;
        await this.persistStudyCard(sessionId, finalObject);
        this.logger.info('analysis stream done', {
            sessionId,
            messageId,
            chunkCount,
            durationMs: Date.now() - startedAt,
        });
        this.rendererGateway.fireAndForget('chat/analysis/stream', {
            sessionId,
            messageId,
            chunk: { type: 'data-analysis', id: messageId, data: finalObject },
        });
        this.rendererGateway.fireAndForget('chat/analysis/stream', {
            sessionId,
            messageId,
            chunk: { type: 'finish', finishReason: 'stop' },
        });
    }

    private async persistStudyCard(sessionId: string, studyCard: SentenceStudyCard): Promise<void> {
        if (!this.studyNoteRepository) return;
        try {
            const session = this.chatSessionStore.get(sessionId);
            if (!session.subtitleFileHash || session.anchorSentenceIndex === undefined) return;
            await this.studyNoteRepository.saveStudyCard({
                sentenceKey: session.sentenceKey,
                videoId: session.videoId,
                fileHash: session.subtitleFileHash,
                sentenceIndex: session.anchorSentenceIndex,
                originalText: session.originalTopic,
                studyCard,
                presetId: session.presetId ?? null,
            });
        } catch (error) {
            this.logger.warn('failed to persist sentence study card', { sessionId, error });
        }
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

    private handleAnalysisError(sessionId: string, messageId: string, error: unknown): void {
        const cancelled = isUserCancellation(error);
        const errorMessage = describeStreamError(error);
        if (!cancelled) {
            this.logger.error('analysis stream failed', { error: errorMessage });
        }
        this.rendererGateway.fireAndForget('chat/analysis/stream', {
            sessionId,
            messageId,
            chunk: cancelled
                ? { type: 'abort', reason: '用户已取消分析' }
                : { type: 'error', errorText: errorMessage },
        });
    }
}
