import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-chat-test',
        getVersion: () => '6.1.0',
    },
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { ChatSessionServiceImpl } from '@/backend/services/ChatSessionService';
import { InMemoryChatSessionStore } from '@/backend/services/chat/ChatSessionStore';
import type AiProviderService from '@/backend/services/AiProviderService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type SentenceLearningService from '@/backend/services/SentenceLearningService';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type CacheService from '@/backend/services/CacheService';
import type LearningPromptPresetService from '@/backend/services/chat/LearningPromptPresetService';

describe('ChatSessionService 并发与停止生命周期', () => {
    it('startAnalysis 在异步 resolvePersona 窗口并发重入只应启动同一 run，且 stop 后允许再次启动', async () => {
        const store = new InMemoryChatSessionStore();
        const session = store.create({
            videoId: 'v1',
            originalTopic: 'Hello world.',
            paragraphLines: ['Hello world.'],
            subtitleFileHash: 'h1',
            anchorSentenceIndex: 0,
        });

        const resolvers: Array<() => void> = [];
        const promptPresetService = {
            resolvePrompt: vi.fn().mockImplementation(
                () => new Promise<{ rawPrompt: string }>((resolve) => {
                    resolvers.push(() => resolve({ rawPrompt: 'be concise' }));
                }),
            ),
        } as unknown as LearningPromptPresetService;

        const rendererGateway = { fireAndForget: vi.fn(), call: vi.fn() } as unknown as RendererGateway;
        const service = new ChatSessionServiceImpl(
            { getModel: vi.fn().mockReturnValue(null) } as unknown as AiProviderService,
            { streamText: vi.fn(() => new Promise(() => undefined)) } as unknown as LocalAiService,
            { resolveLocalModelId: vi.fn().mockResolvedValue('local-model') } as unknown as SentenceLearningService,
            rendererGateway,
            store,
            { get: vi.fn().mockReturnValue(null) } as unknown as CacheService,
            undefined,
            promptPresetService,
        );

        const p1 = service.startAnalysis({ sessionId: session.id });
        await vi.waitFor(() => expect(resolvers.length).toBe(1));
        const p2 = service.startAnalysis({ sessionId: session.id });

        resolvers.shift()?.();
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.messageId).toBe(r2.messageId);

        service.stop(session.id);
        expect(store.get(session.id).analysisRunId).toBeNull();

        // stop 后再 startAnalysis 应开启全新 messageId，而不是卡在旧 runId
        const p3 = service.startAnalysis({ sessionId: session.id });
        await vi.waitFor(() => expect(resolvers.length).toBe(1));
        resolvers.shift()?.();
        const r3 = await p3;
        expect(r3.messageId).not.toBe(r1.messageId);
    });
});
