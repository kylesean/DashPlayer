import { describe, expect, it, vi } from 'vitest';
import type { LocalAiModelDefinition } from '@/common/contracts/local-ai';

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { LlamaServerProcess } from '@/backend/infrastructure/ai/LlamaServerProcess';

describe('LlamaServerProcess stop 与 in-flight 冷启动收敛', () => {
    it('start 仍在校验完整性时调用 stop 应立即中止冷启动且不孵化后续子进程', async () => {
        const lifetime = new AbortController();
        let verifySignal: AbortSignal | undefined;

        const proc = new LlamaServerProcess({
            lifetimeSignal: lifetime.signal,
            resolveModelPath: async () => '/models/test.gguf',
            fileSize: async () => 1234,
            verifyIntegrity: async (_model, _path, signal) => {
                verifySignal = signal;
                await new Promise<void>((_resolve, reject) => {
                    if (signal?.aborted) {
                        reject(signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                        return;
                    }
                    signal?.addEventListener('abort', () => {
                        reject(signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                    }, { once: true });
                });
            },
        });

        const model: LocalAiModelDefinition = {
            id: 'qwen-test',
            name: 'Qwen Test',
            file: 'test.gguf',
            bytes: 1234,
            sizeLabel: '1KB',
            urls: [],
            sha256: 'abc',
            source: 'catalog',
        };

        const callerAbort = new AbortController();
        const startPromise = proc.start(model, callerAbort.signal);
        await vi.waitFor(() => expect(verifySignal).toBeDefined());

        await proc.stop();
        expect(verifySignal?.aborted).toBe(true);
        await expect(startPromise).rejects.toThrow();
        expect(proc.isRunning()).toBe(false);
    });
});
