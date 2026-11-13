import { randomUUID } from 'node:crypto';
import { injectable } from 'inversify';
import type { ModelMessage } from 'ai';
import {
    buildSentenceStudyKey,
    type ChatSessionCreateParams,
    type PersistedChatMessage,
} from '@/common/types/chat';
import type { SentenceMemoryHints } from '@/common/types/vo/SentenceVocabularyVO';

/**
 * 内存中的一次整句学习会话。
 */
export type ChatSession = {
    /** 后端生成的会话标识。 */
    id: string;
    /** 句级持久化主键（fileHash:sentenceIndex）。 */
    sentenceKey: string;
    /** 所属视频标识。 */
    videoId: string;
    /** 创建会话时选中的学习文本。 */
    originalTopic: string;
    /** 创建会话时冻结的周边字幕。 */
    paragraphLines: string[];
    /** 当前字幕缓存的 fileHash。 */
    subtitleFileHash: string;
    /** 当前学习句在字幕缓存中的索引。 */
    anchorSentenceIndex: number;
    /** 当前教学预设 ID（缺省走全局激活预设）。 */
    presetId?: string;
    /** 会话级提示词覆盖文本。 */
    customPromptOverride?: string;
    /** 当前句子的学习者记忆提示。 */
    memoryHints?: SentenceMemoryHints;
    /** 是否已经向对话流注入过字幕上下文参考材料。 */
    contextInjected: boolean;
    /** 已完成并可用于后续请求的模型消息历史。 */
    messages: ModelMessage[];
    /** 与历史一一对应的可持久化前端视图消息记录。 */
    persistedMessages: PersistedChatMessage[];
    /** 当前会话是否已关闭。 */
    closed: boolean;
    /** 当前仍在执行的生成请求。 */
    runs: Map<string, AbortController>;
    /** 当前在跑的精读分析 run（sendMessage 的 run 不在此列）；null 表示没有。 */
    analysisRunId: string | null;
    /**
     * 会话内已确认「不支持工具调用」的模型 id 集合（降级记忆）。
     * 按 model id 键控：换模型/预设自动失效重试；会话内存活，进程重启自然清零。
     */
    toolsUnsupportedModelIds: Set<string>;
};

export default interface ChatSessionStore {
    create(params: ChatSessionCreateParams): ChatSession;
    get(sessionId: string): ChatSession;
    appendMessage(sessionId: string, message: ModelMessage): void;
    appendPersistedMessage(sessionId: string, message: PersistedChatMessage): void;
    updatePreset(sessionId: string, preset: { presetId?: string; customPromptOverride?: string }): void;
    markContextInjected(sessionId: string): void;
    /** 原子认领首轮上下文注入资格；返回 true 表示本轮需要注入且已置位。 */
    claimContextInjection(sessionId: string): boolean;
    releaseContextInjection(sessionId: string): void;
    /** 记录「该模型在本会话内不支持工具调用」。会话不存在时静默忽略。 */
    markToolsUnsupported(sessionId: string, modelId: string): void;
    /** 查询该模型在本会话内是否已触发过工具降级。会话不存在时返回 false。 */
    isToolsUnsupported(sessionId: string, modelId: string): boolean;
    startRun(sessionId: string, runId: string): AbortSignal;
    finishRun(sessionId: string, runId: string): void;
    /** 只中止一个 run（如精读分析），不影响同会话的其它流。 */
    stopRun(sessionId: string, runId: string): boolean;
    stop(sessionId: string): void;
    close(sessionId: string): void;
}

const restoredToModelMessages = (restored?: PersistedChatMessage[]): ModelMessage[] => {
    if (!restored || restored.length === 0) return [];
    const output: ModelMessage[] = [];
    for (const item of restored) {
        const text = item.plainText.trim();
        if (!text) continue;
        output.push({
            role: item.role,
            content: text,
        });
    }
    return output;
};

/** 内存会话的容量上限：逐句学习每句一个会话（含注入的字幕上下文长文本），
 * 不淘汰的话 main 进程内存随使用单调增长。只回收已关闭且无在途 run 的旧会话。 */
const MAX_RETAINED_SESSIONS = 50;

@injectable()
export class InMemoryChatSessionStore implements ChatSessionStore {
    private readonly sessions = new Map<string, ChatSession>();

    /** 超出容量上限时按插入序回收最旧的已关闭且无在途 run 的会话；找不到可回收对象则不动。 */
    private evictStaleSessions(): void {
        if (this.sessions.size <= MAX_RETAINED_SESSIONS) {
            return;
        }
        for (const [id, session] of this.sessions) {
            if (this.sessions.size <= MAX_RETAINED_SESSIONS) {
                break;
            }
            if (session.closed && session.runs.size === 0) {
                this.sessions.delete(id);
            }
        }
    }

    public create(params: ChatSessionCreateParams): ChatSession {
        const id = randomUUID();
        const sentenceKey = params.sentenceKey
            || buildSentenceStudyKey(params.subtitleFileHash, params.anchorSentenceIndex);
        const restored = params.restoredMessages ? [...params.restoredMessages] : [];
        const session: ChatSession = {
            id,
            sentenceKey,
            videoId: params.videoId,
            originalTopic: params.originalTopic,
            paragraphLines: [...params.paragraphLines],
            subtitleFileHash: params.subtitleFileHash,
            anchorSentenceIndex: params.anchorSentenceIndex,
            presetId: params.presetId,
            customPromptOverride: params.customPromptOverride,
            memoryHints: params.memoryHints,
            contextInjected: false,
            messages: restoredToModelMessages(restored),
            persistedMessages: restored,
            closed: false,
            runs: new Map(),
            analysisRunId: null,
            toolsUnsupportedModelIds: new Set<string>(),
        };
        this.sessions.set(id, session);
        this.evictStaleSessions();
        return session;
    }

    public get(sessionId: string): ChatSession {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`chat session not found: ${sessionId}`);
        }
        return session;
    }

    public appendMessage(sessionId: string, message: ModelMessage): void {
        const session = this.getOpenSession(sessionId);
        session.messages.push(message);
    }

    public appendPersistedMessage(sessionId: string, message: PersistedChatMessage): void {
        const session = this.getOpenSession(sessionId);
        session.persistedMessages.push(message);
    }

    public updatePreset(
        sessionId: string,
        preset: { presetId?: string; customPromptOverride?: string },
    ): void {
        const session = this.getOpenSession(sessionId);
        if (preset.presetId !== undefined) {
            session.presetId = preset.presetId;
        }
        if (preset.customPromptOverride !== undefined) {
            session.customPromptOverride = preset.customPromptOverride;
        }
    }

    public markContextInjected(sessionId: string): void {
        const session = this.getOpenSession(sessionId);
        session.contextInjected = true;
    }

    public claimContextInjection(sessionId: string): boolean {
        const session = this.getOpenSession(sessionId);
        if (session.contextInjected) {
            return false;
        }
        session.contextInjected = true;
        return true;
    }

    public releaseContextInjection(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session && !session.closed) {
            session.contextInjected = false;
        }
    }

    public markToolsUnsupported(sessionId: string, modelId: string): void {
        // 用非抛错的 sessions.get：降级记忆发生在流式回调深处，会话可能已关闭，
        // 此处抛错只会变成一条无处可去的日志
        this.sessions.get(sessionId)?.toolsUnsupportedModelIds.add(modelId);
    }

    public isToolsUnsupported(sessionId: string, modelId: string): boolean {
        return this.sessions.get(sessionId)?.toolsUnsupportedModelIds.has(modelId) ?? false;
    }

    public startRun(sessionId: string, runId: string): AbortSignal {
        const session = this.getOpenSession(sessionId);
        const controller = new AbortController();
        session.runs.set(runId, controller);
        return controller.signal;
    }

    public finishRun(sessionId: string, runId: string): void {
        const session = this.get(sessionId);
        session.runs.delete(runId);
        if (session.analysisRunId === runId) {
            session.analysisRunId = null;
        }
    }

    public stopRun(sessionId: string, runId: string): boolean {
        const session = this.get(sessionId);
        const controller = session.runs.get(runId);
        if (!controller) {
            return false;
        }
        controller.abort('chat run stopped');
        session.runs.delete(runId);
        if (session.analysisRunId === runId) {
            session.analysisRunId = null;
        }
        return true;
    }

    public stop(sessionId: string): void {
        const session = this.getOpenSession(sessionId);
        for (const controller of session.runs.values()) {
            controller.abort('chat run stopped');
        }
        session.runs.clear();
        session.analysisRunId = null;
    }

    public close(sessionId: string): void {
        const session = this.get(sessionId);
        if (session.closed) {
            return;
        }
        session.closed = true;
        session.analysisRunId = null;
        for (const controller of session.runs.values()) {
            controller.abort('chat session closed');
        }
        session.runs.clear();
    }

    private getOpenSession(sessionId: string): ChatSession {
        const session = this.get(sessionId);
        if (session.closed) {
            throw new Error(`chat session is closed: ${sessionId}`);
        }
        return session;
    }
}
