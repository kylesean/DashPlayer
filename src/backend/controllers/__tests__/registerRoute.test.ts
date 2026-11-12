import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// registerRoute 的 IPC 边界语义测试：handler 经 routeRegistry 的记录型落点捕获后
// 直接调用，等价于 ipcMain.handle 收到一次真实调用。
const { ipcLogger, containerGet } = vi.hoisted(() => ({
    ipcLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    containerGet: vi.fn(),
}));

vi.mock('electron', () => ({
    app: { isPackaged: true, getPath: () => '/tmp/dashplayer-register-route-test' },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ipcLogger,
    resolveTraceId: (traceId?: string) => traceId ?? 'register-route-test-trace',
    runWithTrace: (_traceId: unknown, fn: () => unknown) => fn(),
}));

vi.mock('@/backend/ioc/inversify.config', () => ({ default: { get: containerGet } }));

import registerRoute from '@/backend/controllers/ipc/registerRoute';
import type { RouteHandler } from '@/backend/controllers/ipc/routeRegistry';
import {
    resetRouteRegistry,
    setRouteTransport,
} from '@/backend/controllers/ipc/routeRegistry';
import { positiveIntSchema } from '@/backend/controllers/ipc/routeSchemas';
import TYPES from '@/backend/ioc/types';
import type { DpTask } from '@/common/contracts/dp-task';
import { CANCEL_BY_USER_ERROR_NAME } from '@/common/utils/cancellation';

/** 当前捕获的 handler：path -> 注册的 IPC 回调。 */
let captured: Map<string, RouteHandler>;

/** 渲染端错误转发桩，断言「真故障必须通知渲染端」时使用。 */
const rendererError = vi.fn();

describe('registerRoute IPC 边界语义', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetRouteRegistry();
        captured = new Map();
        setRouteTransport((path, handler) => captured.set(path, handler));
        containerGet.mockReturnValue({ error: rendererError });
    });

    it('无参路由：param 原样透传，成功结果按 info 级记录', async () => {
        registerRoute('system/app-version', async () => '1.2.3');

        const result = await captured.get('system/app-version')!({}, undefined);

        expect(result).toBe('1.2.3');
        expect(ipcLogger.info).toHaveBeenCalledWith('ipc request started', { path: 'system/app-version', param: undefined });
        expect(ipcLogger.info).toHaveBeenCalledWith('ipc request completed', { path: 'system/app-version', durationMs: expect.any(Number), result: '1.2.3' });
    });

    it('有参路由：schema 校验通过后才进入业务处理函数', async () => {
        let received: number | null = null;
        registerRoute('dp-task/detail', async (id: number) => {
            received = id;
            return null;
        }, { schema: positiveIntSchema });

        const result = await captured.get('dp-task/detail')!({}, 21);

        expect(received).toBe(21);
        expect(result).toBeNull();
    });

    it('有参路由：schema 校验失败在 IPC 边界显式报错并通知渲染端', async () => {
        registerRoute('dp-task/detail', async () => null, { schema: positiveIntSchema });

        await expect(captured.get('dp-task/detail')!({}, 0)).rejects.toThrow('IPC 请求参数校验失败');
        expect(ipcLogger.error).toHaveBeenCalledWith('ipc request failed', expect.objectContaining({ path: 'dp-task/detail' }));
        expect(containerGet).toHaveBeenCalledWith(TYPES.RendererEvents);
        expect(rendererError).toHaveBeenCalledTimes(1);
    });

    /**
     * 回归：界面曾经同时出现两个弹窗——调用方自己的提示，加上 IPC 边界的全局广播。
     * 「没识别出语音」是用户输入问题，不该走全局错误通道。
     */
    it('无语音类失败只记 warn，不广播给渲染端', async () => {
        registerRoute('practice/score-shadowing', async () => {
            throw new Error([
                'whisper.cpp 未返回识别文本：parakeet_init: using Vulkan0',
                'parakeet_print_timings: encode time = 499.95 ms',
                'Segments (0):',
            ].join('\n'));
        }, { schema: { safeParse: () => ({ success: true, data: undefined }) } as never });

        await expect(captured.get('practice/score-shadowing')!({}, undefined)).rejects.toThrow('未返回识别文本');

        expect(rendererError).not.toHaveBeenCalled();
        expect(ipcLogger.warn).toHaveBeenCalledWith(
            'ipc request failed with no speech',
            expect.objectContaining({ path: 'practice/score-shadowing' }),
        );
        // 日志仍保留完整异常，排查不受影响
        expect(ipcLogger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            path: 'practice/score-shadowing',
            error: expect.any(Error),
        }));
    });

    it('schema 漏写可选字段时，契约外顶层字段直接拒绝而不是静默丢弃', async () => {
        registerRoute(
            'practice/list-by-sentence',
            async ({ fileHash }: { fileHash: string; sentenceIndex: number }) => {
                // handler 体不在本测试范围；返回值只需对齐契约类型（SentencePracticeRecordVO[]）。
                void fileHash;
                return [];
            },
            {
                schema: z.object({ fileHash: z.string(), sentenceIndex: z.number() }),
            },
        );

        await expect(captured.get('practice/list-by-sentence')!({}, {
            fileHash: 'abc',
            sentenceIndex: 1,
            smuggled: 'x',
        })).rejects.toThrow(/未声明字段.*smuggled/);
    });

    it('命中 QUIET 策略的路径降为 debug，且按策略跳过 result', async () => {
        registerRoute('dp-task/detail', async () => ({ secret: 'payload' } as unknown as DpTask), { schema: positiveIntSchema });

        await captured.get('dp-task/detail')!({}, 1);

        expect(ipcLogger.info).not.toHaveBeenCalled();
        expect(ipcLogger.debug).toHaveBeenCalledWith('ipc request started', { path: 'dp-task/detail', param: 1 });
        expect(ipcLogger.debug).toHaveBeenCalledWith('ipc request completed', { path: 'dp-task/detail', durationMs: expect.any(Number) });
    });

    it('用户取消按 warn 记录，不转发渲染端错误', async () => {
        registerRoute('system/app-version', async () => {
            const error = new Error('caller aborted');
            error.name = CANCEL_BY_USER_ERROR_NAME;
            throw error;
        });

        await expect(captured.get('system/app-version')!({}, undefined)).rejects.toThrow('caller aborted');

        expect(ipcLogger.warn).toHaveBeenCalledWith('ipc request cancelled', expect.objectContaining({ path: 'system/app-version' }));
        expect(ipcLogger.error).not.toHaveBeenCalled();
        expect(rendererError).not.toHaveBeenCalled();
    });
});
