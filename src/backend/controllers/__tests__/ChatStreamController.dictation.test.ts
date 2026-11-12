import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock('electron', () => ({
    app: { isPackaged: true, getPath: () => '/tmp/dashplayer-chat-dictation-test' },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    BrowserWindow: class {},
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    resolveTraceId: (traceId?: string) => traceId ?? 'test-trace',
    runWithTrace: async (_traceId: unknown, fn: () => unknown) => fn(),
}));

vi.mock('@/backend/ioc/inversify.config', () => ({
    default: {
        get: vi.fn(() => ({ error: vi.fn(), info: vi.fn() })),
    },
}));

vi.mock('@/backend/controllers/ipc/routeRegistry', () => ({
    registerIpcRoute: vi.fn((path: string, _hasSchema: boolean, handler: (...args: unknown[]) => Promise<unknown>) => {
        registeredHandlers.set(path, handler);
    }),
}));

import ChatStreamController from '../ChatStreamController';

describe('ChatStreamController chat/transcribe-audio 语音听写容错', () => {
    beforeEach(() => {
        registeredHandlers.clear();
    });

    it('拦截并清洗 parakeet Segments (0) 原始 C++ stderr 日志', async () => {
        const transcribeOnce = vi.fn().mockRejectedValue(
            new Error('whisper.cpp 未返回识别文本：parakeet_model_load: model size = 668.50 MB\nSegments (0):'),
        );
        const controller = new ChatStreamController(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { transcribeOnce } as never,
        );
        controller.registerRoutes();

        const handler = registeredHandlers.get('chat/transcribe-audio');
        expect(handler).toBeDefined();

        await expect(handler!(undefined, { audio: new Uint8Array(2048) })).rejects.toThrow(
            '未识别到清晰英语语音（当前 Parakeet 模型仅支持英文输入；说中文请直接打字或在设置切换语音模型）',
        );
    });

    it('拒绝过短音频而不触发底层推理', async () => {
        const transcribeOnce = vi.fn();
        const controller = new ChatStreamController(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { transcribeOnce } as never,
        );
        controller.registerRoutes();

        const handler = registeredHandlers.get('chat/transcribe-audio');
        await expect(handler!(undefined, { audio: new Uint8Array(128) })).rejects.toThrow(
            '录音时间过短，请多说几个词再结束录音',
        );
        expect(transcribeOnce).not.toHaveBeenCalled();
    });
});
