import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-whisper-gateway-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

// 模型文件存在性检查在真实环境依赖本地安装,单测里统一放行
vi.mock('fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('fs')>()),
    existsSync: vi.fn(() => true),
}));

import { CancelByUserError } from '@/backend/utils/errors/errors';
import WhisperCppGatewayImpl from '@/backend/infrastructure/media/whispercpp/WhisperCppGatewayImpl';
import type { WhisperCppCli, WhisperCppOutput, WhisperCppRunRequest } from '@/backend/infrastructure/media/whispercpp/WhisperCppCli';

/** 构造网关实例与受控的 CLI 桩:按脚本依次返回结果或抛错,记录每次 run 的请求。 */
const buildGateway = (script: Array<() => Promise<WhisperCppOutput>>) => {
    const calls: WhisperCppRunRequest[] = [];
    let index = 0;
    const cli = {
        run: vi.fn(async (request: WhisperCppRunRequest) => {
            calls.push(request);
            const step = script[Math.min(index, script.length - 1)];
            index += 1;
            return step();
        }),
        killActive: vi.fn(),
        resolveExecutablePath: vi.fn(),
    } as unknown as WhisperCppCli;
    return { gateway: new WhisperCppGatewayImpl(cli), calls };
};

const OUTPUT: WhisperCppOutput = {
    text: 'You can say, "No, thanks."',
    tokens: [{ text: ' You', start: 0, end: 0.2 }],
};

const REQUEST = {
    audioPath: '/tmp/a.wav',
    modelsRoot: '/models',
    job: 'practice:test',
};

describe('WhisperCppGatewayImpl GPU 崩溃回退 CPU', () => {
    it('GPU 尝试 SIGSEGV 后自动禁用 Vulkan 重试一次并返回结果', async () => {
        const { gateway, calls } = buildGateway([
            () => Promise.reject(new Error('whisper.cpp 被信号 SIGSEGV 终止：ggml_vulkan: Device memory allocation of size 334689568 failed. ErrorOutOfDeviceMemory')),
            () => Promise.resolve(OUTPUT),
        ]);

        const result = await gateway.transcribe(REQUEST);
        expect(result.text).toBe(OUTPUT.text);
        expect(calls).toHaveLength(2);
        expect(calls[0].disableGpu).toBe(false);
        expect(calls[1].disableGpu).toBe(true);
    });

    it('用户主动取消不触发 CPU 重试', async () => {
        const { gateway, calls } = buildGateway([
            () => Promise.reject(new CancelByUserError('Transcription cancelled by user')),
        ]);

        await expect(gateway.transcribe(REQUEST)).rejects.toBeInstanceOf(CancelByUserError);
        expect(calls).toHaveLength(1);
    });

    it('CPU 重试仍失败时抛出后一次的原始错误', async () => {
        const { gateway, calls } = buildGateway([
            () => Promise.reject(new Error('whisper.cpp 被信号 SIGSEGV 终止：ErrorOutOfDeviceMemory')),
            () => Promise.reject(new Error('whisper.cpp 未返回识别文本：audio format error')),
        ]);

        await expect(gateway.transcribe(REQUEST)).rejects.toThrow('未返回识别文本');
        expect(calls).toHaveLength(2);
    });

    it('首次就成功时不做额外重试', async () => {
        const { gateway, calls } = buildGateway([
            () => Promise.resolve(OUTPUT),
        ]);

        await expect(gateway.transcribe(REQUEST)).resolves.toMatchObject({ text: OUTPUT.text });
        expect(calls).toHaveLength(1);
        expect(calls[0].disableGpu).toBe(false);
    });
});
