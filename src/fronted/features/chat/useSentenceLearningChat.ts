import { useEffect, useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import useChatPanel from '@/fronted/features/chat/chatStore';
import { ElectronChatTransport } from '@/fronted/features/chat/chatTransport';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import type { LearningMessageBlock, LearningMessageView } from '@/fronted/features/chat/types';
import type {
    GetSubtitleContextResult,
    PersistedChatMessage,
    SearchSubtitlesResult,
} from '@/common/types/chat';

const toMessageBlocks = (message: UIMessage): LearningMessageBlock[] => {
    const blocks: LearningMessageBlock[] = [];
    message.parts.forEach((part) => {
        if (part.type === 'text') {
            if (part.text.trim().length > 0) {
                blocks.push({ kind: 'text', text: part.text });
            }
            return;
        }
        if (!isToolUIPart(part)) {
            return;
        }
        if (part.state === 'output-error') {
            blocks.push({ kind: 'error', text: part.errorText });
            return;
        }

        const running = part.state === 'input-streaming' || part.state === 'input-available';
        const toolName = getToolName(part);
        if (toolName === 'search_subtitles') {
            const input = part.input as { queries?: string[] } | undefined;
            const output = part.output as SearchSubtitlesResult | undefined;
            const hits = output?.matches ?? [];
            blocks.push({
                kind: 'search',
                queries: input?.queries ?? [],
                hits,
                total: output?.total ?? hits.length,
                running,
            });
            return;
        }
        if (toolName === 'get_subtitle_context') {
            const output = part.output as GetSubtitleContextResult | undefined;
            blocks.push({
                kind: 'context',
                range: output?.startIndex !== undefined && output?.endIndex !== undefined
                    ? { start: output.startIndex, end: output.endIndex }
                    : null,
                running,
            });
        }
    });
    return blocks;
};

const toMessageView = (message: UIMessage): LearningMessageView => ({
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    blocks: toMessageBlocks(message),
});

const persistedToUiMessages = (persisted: PersistedChatMessage[]): UIMessage[] => {
    return persisted.map((item) => {
        const parts: UIMessage['parts'] = [];
        item.blocks.forEach((block, idx) => {
            if (block.kind === 'text') {
                parts.push({ type: 'text', text: block.text, state: 'done' });
            } else if (block.kind === 'search') {
                parts.push({
                    type: 'tool-search_subtitles',
                    toolCallId: `${item.id}-search-${idx}`,
                    state: 'output-available',
                    input: { queries: block.queries },
                    output: {
                        matches: block.hits.map((hit) => ({
                            ...hit,
                            start: 0,
                            end: 0,
                            matchedQueries: block.queries,
                        })),
                        total: block.total,
                        skip: 0,
                        limit: block.hits.length,
                    },
                } as unknown as UIMessage['parts'][number]);
            } else if (block.kind === 'context') {
                parts.push({
                    type: 'tool-get_subtitle_context',
                    toolCallId: `${item.id}-context-${idx}`,
                    state: 'output-available',
                    input: {},
                    output: {
                        anchorIndex: block.range?.start ?? 0,
                        startIndex: block.range?.start ?? 0,
                        endIndex: block.range?.end ?? 0,
                        items: [],
                    },
                } as unknown as UIMessage['parts'][number]);
            }
        });
        if (parts.length === 0 && item.plainText) {
            parts.push({ type: 'text', text: item.plainText, state: 'done' });
        }
        return {
            id: item.id,
            role: item.role,
            parts,
        };
    });
};

/**
 * 管理整句学习工作台的多轮对话流、SQLite 历史恢复、焦点词挂载与停止/报错。
 */
export const useSentenceLearningChat = () => {
    const {
        chatSessionId,
        restoredMessages,
        queuedMessage,
        consumeQueuedMessage,
        input,
        setInput,
        attachedFocusExpr,
        setAttachedFocusExpr,
        conversationEpoch,
    } = useChatPanel();
    const logger = useMemo(() => getRendererLogger('SentenceLearningChat'), []);
    const transport = useMemo(() => new ElectronChatTransport(), []);
    const chat = useChat({
        id: chatSessionId || 'inactive-chat-session',
        transport,
        throttle: 40,
    });
    const { messages, sendMessage, setMessages, status, stop, error: chatError } = chat;
    const isBusy = status === 'submitted' || status === 'streaming';
    const appliedEpochRef = useRef(conversationEpoch);
    const hydratedSessionRef = useRef<string>('');

    // 当切换到带有 SQLite 历史的句子会话时，恢复历史消息卡片到 useChat
    useEffect(() => {
        if (!chatSessionId) {
            hydratedSessionRef.current = '';
            return;
        }
        if (hydratedSessionRef.current === chatSessionId) {
            return;
        }
        hydratedSessionRef.current = chatSessionId;
        if (restoredMessages.length > 0 && messages.length === 0) {
            setMessages(persistedToUiMessages(restoredMessages));
            logger.debug('restored persisted study chat messages', {
                sessionId: chatSessionId,
                count: restoredMessages.length,
            });
        }
    }, [chatSessionId, logger, messages.length, restoredMessages, setMessages]);

    // 显式点击清空对话按钮（conversationEpoch 递增）时清空当前列表
    useEffect(() => {
        if (appliedEpochRef.current === conversationEpoch) {
            return;
        }
        if (isBusy) {
            return;
        }
        appliedEpochRef.current = conversationEpoch;
        setMessages([]);
    }, [conversationEpoch, isBusy, setMessages]);

    useEffect(() => {
        if (!queuedMessage || !chatSessionId || status !== 'ready') {
            return;
        }
        const { id, content } = queuedMessage;
        consumeQueuedMessage(id);
        sendMessage({ text: content }).catch(() => undefined);
    }, [chatSessionId, consumeQueuedMessage, queuedMessage, sendMessage, status]);

    const messageViews = useMemo(() => messages.map(toMessageView), [messages]);

    const handleSubmit = async (text: string) => {
        const trimmedInput = text.trim();
        if (!trimmedInput || isBusy || !chatSessionId) {
            return;
        }
        const focusExpr = attachedFocusExpr?.trim();
        const outboundText = focusExpr
            ? `[聚焦表达: ${focusExpr}]\n${trimmedInput}`
            : trimmedInput;
        setInput('');
        if (focusExpr) {
            setAttachedFocusExpr(null);
        }
        await sendMessage({ text: outboundText });
    };

    return {
        messageViews,
        status,
        stop,
        input,
        setInput,
        attachedFocusExpr,
        setAttachedFocusExpr,
        handleSubmit,
        isBusy,
        chatErrorText: chatError ? (chatError.message || String(chatError)) : null,
    };
};

export type SentenceLearningChat = ReturnType<typeof useSentenceLearningChat>;
