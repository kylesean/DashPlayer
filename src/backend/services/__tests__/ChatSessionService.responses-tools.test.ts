import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-chat-responses-test',
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

const makeSseResponse = (events: Array<{ event: string; data: Record<string, unknown> }>) => {
    const payload = events
        .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        .join('');
    return new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(payload));
                controller.close();
            },
        }),
        {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        },
    );
};

describe('ChatSessionService OpenAI Responses 多轮工具调用兼容性', () => {
    it('使用 openai-responses 时设置 store=false 并回传完整 function_call 而非 item_reference', async () => {
        const requestBodies: Array<Record<string, unknown>> = [];
        let callIndex = 0;

        const mockFetch: typeof fetch = async (_input, init) => {
            callIndex += 1;
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            requestBodies.push(body);

            if (callIndex === 1) {
                return makeSseResponse([
                    {
                        event: 'response.created',
                        data: { type: 'response.created', response: { id: 'resp_1' } },
                    },
                    {
                        event: 'response.output_item.added',
                        data: {
                            type: 'response.output_item.added',
                            output_index: 0,
                            item: {
                                type: 'function_call',
                                id: 'fc_item_1',
                                call_id: 'call_00_test123',
                                name: 'search_subtitles',
                                arguments: '',
                            },
                        },
                    },
                    {
                        event: 'response.function_call_arguments.delta',
                        data: {
                            type: 'response.function_call_arguments.delta',
                            item_id: 'fc_item_1',
                            output_index: 0,
                            delta: '{"queries":["fudge"]}',
                        },
                    },
                    {
                        event: 'response.output_item.done',
                        data: {
                            type: 'response.output_item.done',
                            output_index: 0,
                            item: {
                                type: 'function_call',
                                id: 'fc_item_1',
                                call_id: 'call_00_test123',
                                name: 'search_subtitles',
                                arguments: '{"queries":["fudge"]}',
                                status: 'completed',
                            },
                        },
                    },
                    {
                        event: 'response.completed',
                        data: {
                            type: 'response.completed',
                            response: {
                                id: 'resp_1',
                                incomplete_details: null,
                                usage: { input_tokens: 10, output_tokens: 5 },
                            },
                        },
                    },
                ]);
            }

            return makeSseResponse([
                {
                    event: 'response.created',
                    data: { type: 'response.created', response: { id: 'resp_2' } },
                },
                {
                    event: 'response.output_item.added',
                    data: {
                        type: 'response.output_item.added',
                        output_index: 0,
                        item: { type: 'message', id: 'msg_2', role: 'assistant', content: [] },
                    },
                },
                {
                    event: 'response.content_part.added',
                    data: {
                        type: 'response.content_part.added',
                        item_id: 'msg_2',
                        output_index: 0,
                        content_index: 0,
                        part: { type: 'output_text', text: '' },
                    },
                },
                {
                    event: 'response.output_text.delta',
                    data: {
                        type: 'response.output_text.delta',
                        item_id: 'msg_2',
                        output_index: 0,
                        content_index: 0,
                        delta: '已检索并解答。',
                    },
                },
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        output_index: 0,
                        item: {
                            type: 'message',
                            id: 'msg_2',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: '已检索并解答。', annotations: [] }],
                        },
                    },
                },
                {
                    event: 'response.completed',
                    data: {
                        type: 'response.completed',
                        response: {
                            id: 'resp_2',
                            incomplete_details: null,
                            usage: { input_tokens: 20, output_tokens: 6 },
                        },
                    },
                },
            ]);
        };

        const model = createOpenAI({
            baseURL: 'https://mock.responses.local/v1',
            apiKey: 'test-key',
            fetch: mockFetch,
        }).responses('deepseek-chat');

        const store = new InMemoryChatSessionStore();
        const session = store.create({
            videoId: 'v1',
            originalTopic: 'This is a fudge stick.',
            paragraphLines: ['This is a fudge stick.'],
            subtitleFileHash: 'h1',
            anchorSentenceIndex: 1,
        });

        const chunks: Array<{ type?: string }> = [];
        const rendererGateway = {
            fireAndForget: vi.fn((_path: string, params: { chunk?: { type?: string } }) => {
                if (params.chunk) chunks.push(params.chunk);
            }),
            call: vi.fn(),
        } as unknown as RendererGateway;

        const cacheService = {
            get: vi.fn().mockReturnValue({
                sentences: [{ index: 1, start: 0, end: 2, text: 'This is a fudge stick.' }],
            }),
        } as unknown as CacheService;

        const service = new ChatSessionServiceImpl(
            { getModel: vi.fn().mockReturnValue(model) } as unknown as AiProviderService,
            {} as LocalAiService,
            {} as SentenceLearningService,
            rendererGateway,
            store,
            cacheService,
        );

        await service.sendMessage({ sessionId: session.id, content: '解释一下' });
        await vi.waitFor(() => expect(chunks.some((c) => c.type === 'finish')).toBe(true));

        expect(requestBodies).toHaveLength(2);
        const secondInput = requestBodies[1].input as Array<Record<string, unknown>>;
        expect(requestBodies[1].store).toBe(false);
        expect(secondInput.some((item) => item.type === 'item_reference')).toBe(false);
        expect(secondInput.some((item) => item.type === 'function_call' && item.call_id === 'call_00_test123')).toBe(true);
        expect(secondInput.some((item) => item.type === 'function_call_output' && item.call_id === 'call_00_test123')).toBe(true);
    });

    it('当模型或网关返回不支持 tools 的 400 错误时，自动降级为无工具纯对话且不向前端推送错误', async () => {
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

            return makeSseResponse([
                {
                    event: 'response.created',
                    data: { type: 'response.created', response: { id: 'resp_fallback' } },
                },
                {
                    event: 'response.output_item.added',
                    data: {
                        type: 'response.output_item.added',
                        output_index: 0,
                        item: { type: 'message', id: 'msg_fb', role: 'assistant', content: [] },
                    },
                },
                {
                    event: 'response.content_part.added',
                    data: {
                        type: 'response.content_part.added',
                        item_id: 'msg_fb',
                        output_index: 0,
                        content_index: 0,
                        part: { type: 'output_text', text: '' },
                    },
                },
                {
                    event: 'response.output_text.delta',
                    data: {
                        type: 'response.output_text.delta',
                        item_id: 'msg_fb',
                        output_index: 0,
                        content_index: 0,
                        delta: '降级纯对话回复成功。',
                    },
                },
                {
                    event: 'response.output_item.done',
                    data: {
                        type: 'response.output_item.done',
                        output_index: 0,
                        item: {
                            type: 'message',
                            id: 'msg_fb',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: '降级纯对话回复成功。', annotations: [] }],
                        },
                    },
                },
                {
                    event: 'response.completed',
                    data: {
                        type: 'response.completed',
                        response: {
                            id: 'resp_fallback',
                            incomplete_details: null,
                            usage: { input_tokens: 15, output_tokens: 8 },
                        },
                    },
                },
            ]);
        };

        const model = createOpenAI({
            baseURL: 'https://mock.responses.local/v1',
            apiKey: 'test-key',
            fetch: mockFetch,
        }).responses('weak-local-model');

        const store = new InMemoryChatSessionStore();
        const session = store.create({
            videoId: 'v1',
            originalTopic: 'This is a fudge stick.',
            paragraphLines: ['This is a fudge stick.'],
            subtitleFileHash: 'h1',
            anchorSentenceIndex: 1,
        });

        const chunks: Array<{ type?: string; delta?: string }> = [];
        const rendererGateway = {
            fireAndForget: vi.fn((_path: string, params: { chunk?: { type?: string; delta?: string } }) => {
                if (params.chunk) chunks.push(params.chunk);
            }),
            call: vi.fn(),
        } as unknown as RendererGateway;

        const service = new ChatSessionServiceImpl(
            { getModel: vi.fn().mockReturnValue(model) } as unknown as AiProviderService,
            {} as LocalAiService,
            {} as SentenceLearningService,
            rendererGateway,
            store,
            { get: vi.fn().mockReturnValue(null) } as unknown as CacheService,
        );

        await service.sendMessage({ sessionId: session.id, content: '这句话什么意思？' });
        await vi.waitFor(() => expect(chunks.some((c) => c.type === 'finish')).toBe(true));

        expect(requestBodies).toHaveLength(2);
        expect(requestBodies[0].tools).toBeDefined();
        expect(requestBodies[1].tools).toBeUndefined();
        expect(chunks.some((c) => c.type === 'error')).toBe(false);
        expect(chunks.filter((c) => c.type === 'start')).toHaveLength(1);
        expect(chunks.some((c) => c.type === 'text-delta' && c.delta === '降级纯对话回复成功。')).toBe(true);
    });
});
