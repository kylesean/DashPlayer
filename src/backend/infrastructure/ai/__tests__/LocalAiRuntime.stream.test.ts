import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: { isPackaged: true, getPath: () => '/tmp/dashplayer-stream-test' },
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { LlamaServerProcess, type LlamaStreamEvent } from '@/backend/infrastructure/ai/LlamaServerProcess';

describe('LlamaServerProcess.postChatStream (SSE streaming)', () => {
    const servers: http.Server[] = [];

    afterEach(async () => {
        await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
        servers.length = 0;
    });

    const startMockSseServer = async (chunks: string[]): Promise<string> => {
        const server = http.createServer((req, res) => {
            if (req.url === '/v1/chat/completions' && req.method === 'POST') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache',
                });
                let idx = 0;
                const pushNext = () => {
                    if (idx >= chunks.length) {
                        res.end();
                        return;
                    }
                    res.write(chunks[idx++]);
                    setTimeout(pushNext, 5);
                };
                pushNext();
                return;
            }
            res.writeHead(404).end();
        });
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address() as { port: number };
        return `http://127.0.0.1:${addr.port}`;
    };

    const createProcess = () => new LlamaServerProcess({
        lifetimeSignal: new AbortController().signal,
        resolveModelPath: async () => '/tmp/fake.gguf',
        fileSize: async () => 1,
        verifyIntegrity: async () => undefined,
    });

    it('逐片解析拆分跨越 TCP 包边界的 OpenAI SSE delta 并捕获 finishReason 与 usage', async () => {
        const endpoint = await startMockSseServer([
            'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\ndata: {"choices":',
            '[{"delta":{"content":"好"},"finish_reason":null}]}\r\n\r\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":42,"completion_tokens":2}}\n\n',
            'data: [DONE]\n\n',
        ]);

        const proc = createProcess();
        const events: LlamaStreamEvent[] = [];
        for await (const ev of proc.postChatStream(endpoint, { model: 'custom:gemma-4-E4B_q4_0-it.gguf', messages: [] }, new AbortController().signal)) {
            events.push(ev);
        }

        const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
        const done = events.find((e): e is Extract<LlamaStreamEvent, { type: 'done' }> => e.type === 'done');
        expect(deltas).toBe('你好');
        expect(done?.finishReason).toBe('stop');
        expect(done?.usage).toEqual({ prompt_tokens: 42, completion_tokens: 2 });
        await proc.dispose();
    });

    it('SSE 负载携带 error 字段时显式抛错而不是吞掉异常', async () => {
        const endpoint = await startMockSseServer([
            'data: {"error":{"message":"context length exceeded"}}\n\n',
        ]);

        const proc = createProcess();
        const consume = async () => {
            for await (const _ of proc.postChatStream(endpoint, { model: 'custom:gemma-4-E4B_q4_0-it.gguf', messages: [] }, new AbortController().signal)) {
                // drain
            }
        };

        await expect(consume()).rejects.toThrow('context length exceeded');
        await proc.dispose();
    });
});
