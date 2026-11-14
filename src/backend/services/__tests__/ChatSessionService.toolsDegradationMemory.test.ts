import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-chat-degradation-test',
        getVersion: () => '6.1.0',
    },
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createOpenAI } from '@ai-sdk/openai';
import { ChatSessionServiceImpl } from '@/backend/services/ChatSessionService';
import { InMemoryChatSessionStore } from '@/backend/services/chat/ChatSessionStore';
import type AiProviderService from '@/backend/services/AiProviderService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type SentenceLearningService from '@/backend/services/SentenceLearningService';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type CacheService from '@/backend/services/CacheService';

const makeTextSseResponse = (text: string) => {
    const payload = [
        { event: 'response.created', data: { type: 'response.created', response: { id: 'resp_x' } } },
        {
            event: 'response.output_item.added',
            data: {
                type: 'response.output_item.added',
                output_index: 0,
                item: { type: 'message', id: 'msg_x', role: 'assistant', content: [] },
            },
        },
        {
            event: 'response.content_part.added',
            data: {
                type: 'response.content_part.added',
                item_id: 'msg_x',
                output_index: 0,
                content_index: 0,
                part: { type: 'output_text', text: '' },
            },
        },
        { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', item_id: 'msg_x', output_index: 0, content_index: 0, delta: text } },
        {
            event: 'response.output_item.done',
            data: {
                type: 'response.output_item.done',
                output_index: 0,
                item: { type: 'message', id: 'msg_x', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] },
            },
        },
        {
            event: 'response.completed',
            data: { type: 'response.completed', response: { id: 'resp_x', incomplete_details: null, usage: { input_tokens: 5, output_tokens: 3 } } },
        },
    ]
        .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        .join('');
    return new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const makeChatSseResponse = (text: string) => {
    const chunk = {
        id: 'chatcmpl_x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-chat',
        choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    };
    const done = {
        id: 'chatcmpl_x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-chat',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    const payload = `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`;
    return new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const makeService = (
    store: InMemoryChatSessionStore,
    mockFetch: typeof fetch,
): ChatSessionServiceImpl => {
    const model = createOpenAI({
        baseURL: 'https://mock.degradation.local/v1',
        apiKey: 'test-key',
        fetch: mockFetch,
    }).responses('deepseek-chat');
    const rendererGateway = {
        fireAndForget: vi.fn(),
        call: vi.fn(),
    } as unknown as RendererGateway;
    return new ChatSessionServiceImpl(
        { getModel: vi.fn().mockReturnValue(model) } as unknown as AiProviderService,
        {} as LocalAiService,
        {} as SentenceLearningService,
        rendererGateway,
        store,
        { get: vi.fn().mockReturnValue(null) } as unknown as CacheService,
    );
};

describe('ChatSessionService 工具降级的会话级记忆', () => {
    it('同会话同模型只降级一次：后续消息直接无工具请求，不再重复失败往返', async () => {
        const requestBodies: Array<Record<string, unknown>> = [];
        let callIndex = 0;
        const mockFetch: typeof fetch = async (_input, init) => {
            callIndex += 1;
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            requestBodies.push(body);
            if (callIndex === 1) {
                return new Response(
                    JSON.stringify({ error: { message: 'tools is not supported by this model' } }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } },
                );
            }
            return makeTextSseResponse('好的。');
        };

        const store = new InMemoryChatSessionStore();
        const session = store.create({
            videoId: 'v1',
            originalTopic: 'Yes.',
            paragraphLines: ['Yes.'],
            subtitleFileHash: 'h1',
            anchorSentenceIndex: 0,
        });
        const service = makeService(store, mockFetch);

        // 第一条消息：带工具请求 → 400 → 降级重跑
        await service.sendMessage({ sessionId: session.id, content: '第一条' });
        await vi.waitFor(() => expect(callIndex).toBeGreaterThanOrEqual(2));

        expect(requestBodies[0]?.tools).toBeDefined();
        expect(requestBodies[1]?.tools).toBeUndefined();
        expect(session.toolsUnsupportedModelIds.has('openai.responses:deepseek-chat')).toBe(true);

        // 第二条消息：命中降级记忆，直接无工具，且不再产生 400 往返
        await service.sendMessage({ sessionId: session.id, content: '第二条' });
        await vi.waitFor(() => expect(callIndex).toBe(3));

        expect(requestBodies[2]?.tools).toBeUndefined();
    });

    it('降级记忆按会话隔离：新会话同模型仍先尝试工具', async () => {
        const requestBodies: Array<Record<string, unknown>> = [];
        const mockFetch: typeof fetch = async (_input, init) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            requestBodies.push(body);
            return makeTextSseResponse('好的。');
        };

        const store = new InMemoryChatSessionStore();
        // 会话 A 先注入降级记忆（模拟上一次会话内已发生过降级）
        const sessionA = store.create({
            videoId: 'v1',
            originalTopic: 'Yes.',
            paragraphLines: ['Yes.'],
            subtitleFileHash: 'h1',
            anchorSentenceIndex: 0,
        });
        store.markToolsUnsupported(sessionA.id, 'openai.responses:deepseek-chat');

        const service = makeService(store, mockFetch);
        const sessionB = store.create({
            videoId: 'v1',
            originalTopic: 'No.',
            paragraphLines: ['No.'],
            subtitleFileHash: 'h1',
            anchorSentenceIndex: 1,
        });

        await service.sendMessage({ sessionId: sessionB.id, content: '新会话第一条' });
        await vi.waitFor(() => expect(requestBodies).toHaveLength(1));

        expect(requestBodies[0]?.tools).toBeDefined();
        expect(store.isToolsUnsupported(sessionB.id, 'openai.responses:deepseek-chat')).toBe(false);
    });

    it('降级记忆按 provider+modelId 隔离：同会话切换不同 provider 的同名模型仍先尝试工具', async () => {
        const requestBodies: Array<Record<string, unknown>> = [];
        const mockFetch: typeof fetch = async (_input, init) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            requestBodies.push(body);
            return makeChatSseResponse('好的。');
        };

        const store = new InMemoryChatSessionStore();
        const session = store.create({
            videoId: 'v1',
            originalTopic: 'Yes.',
            paragraphLines: ['Yes.'],
            subtitleFileHash: 'h1',
            anchorSentenceIndex: 0,
        });
        // 记录的是 responses provider 降级，切换到 chat provider 同名 modelId 不应误命中
        store.markToolsUnsupported(session.id, 'openai.responses:deepseek-chat');

        const chatModel = createOpenAI({
            baseURL: 'https://mock.degradation.local/v1',
            apiKey: 'test-key',
            fetch: mockFetch,
        }).chat('deepseek-chat');
        const rendererGateway = {
            fireAndForget: vi.fn(),
            call: vi.fn(),
        } as unknown as RendererGateway;
        const service = new ChatSessionServiceImpl(
            { getModel: vi.fn().mockReturnValue(chatModel) } as unknown as AiProviderService,
            {} as LocalAiService,
            {} as SentenceLearningService,
            rendererGateway,
            store,
            { get: vi.fn().mockReturnValue(null) } as unknown as CacheService,
        );

        await service.sendMessage({ sessionId: session.id, content: '换 provider 后第一条' });
        await vi.waitFor(() => expect(requestBodies).toHaveLength(1));

        expect(requestBodies[0]?.tools).toBeDefined();
    });
});
