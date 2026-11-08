import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PassThrough, Readable } from 'stream';
import { LocalAiRuntime } from '@/backend/infrastructure/ai/LocalAiRuntime';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type { LocalAiModelDefinition } from '@/common/contracts/local-ai';

// LocalAiRuntime 的 import 链经 runtimeEnv 依赖 electron（读取 isPackaged），
// vitest 下必须 mock，与其他基础设施测试约定一致。
vi.mock('electron', () => ({
    app: { isPackaged: false, getVersion: () => 'test', getPath: () => '/tmp/dashplayer-local-ai-mirror-test-userdata' },
    shell: { openPath: vi.fn() },
}));

// 字符串常量供 mock 工厂与测试断言共用；vi.mock 工厂会被提升，无法引用普通顶层变量。
const { PRIMARY_URL, BACKUP_URL, MODEL_BODY } = vi.hoisted(() => ({
    PRIMARY_URL: 'https://modelscope.example.com/test.gguf',
    BACKUP_URL: 'https://official.example.com/test.gguf',
    MODEL_BODY: 'gguf-model-content',
}));

// emitProgress 等链路依赖真实模型目录查找；替换目录为单条测试模型，
// 字节数与 SHA256 与预置内容严格一致，模拟真实条目的完整性约束。
vi.mock('@/common/contracts/local-ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/common/contracts/local-ai')>();
    const { createHash } = await import('node:crypto');
    const testModel: LocalAiModelDefinition = {
        id: 'test-model',
        name: '测试模型',
        file: 'test.gguf',
        bytes: Buffer.byteLength(MODEL_BODY),
        sizeLabel: '~9 B',
        urls: [PRIMARY_URL, BACKUP_URL],
        sha256: createHash('sha256').update(MODEL_BODY).digest('hex'),
        source: 'catalog',
    };
    return {
        ...actual,
        // 目录导出替换为测试条目，供 import 侧取用；
        // requireLocalAiModel 读取的是模块内部绑定，覆盖导出的 LOCAL_AI_MODELS 对它无效，
        // 必须直接替换查找函数，emitProgress 等链路才能解析测试模型。
        LOCAL_AI_MODELS: [testModel],
        requireLocalAiModel: (modelId: string) =>
            (modelId === testModel.id ? testModel : actual.requireLocalAiModel(modelId)),
    };
});

import { LOCAL_AI_MODELS } from '@/common/contracts/local-ai';

/** 与 mock 目录中一致的测试模型条目。 */
const TEST_MODEL: LocalAiModelDefinition = LOCAL_AI_MODELS[0];

/** 目录提供器测试替身：固定返回临时模型根目录。 */
class FixedStorageDirectoryProvider implements StorageDirectoryProvider {
    constructor(private readonly rootPath: string) {}

    public async provideDirectory(): Promise<string> {
        return this.rootPath;
    }

    public async ensurePathAccessPermissionIfExists(): Promise<void> {}

    public async getRootStatus(): Promise<never> {
        throw new Error('测试替身不提供目录状态');
    }
}

/** 渲染层网关测试替身：忽略进度广播。 */
class NoopRendererGateway implements RendererGateway {
    public async call(): Promise<void> {
        throw new Error('测试替身不处理后端调用前端');
    }

    public fireAndForget(): void {}
}

/** 暴露受保护 install 方法的运行时子类，便于直接测试下载选源与安装链路。 */
class ExposedLocalAiRuntime extends LocalAiRuntime {
    public installForTest(model: LocalAiModelDefinition, signal: AbortSignal): Promise<void> {
        return this.install(model, signal);
    }
}

/** 构造一次性写完模型测试体的流式 HTTP 响应。 */
function createModelResponse(): Response {
    const stream = new PassThrough();
    // 宏任务时序：install 在 await 后同步挂载 data 监听与 pipeline，数据必须在此之后写入
    setTimeout(() => {
        stream.write(MODEL_BODY);
        stream.end();
    }, 0);
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, { status: 200, statusText: 'OK' });
}

/** 将全局 fetch 打桩为按清单响应 HEAD 探测与 GET 下载。 */
function mockFetchRoutes(options: {
    reachableUrls: string[];
    getError?: Error;
}): { headUrls: string[]; getUrls: string[] } {
    const headUrls: string[] = [];
    const getUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (init?.method === 'HEAD') {
            headUrls.push(url);
            if (!options.reachableUrls.includes(url)) {
                throw new Error('connection refused');
            }
            return new Response(null, { status: 200, statusText: 'OK' });
        }
        getUrls.push(url);
        if (options.getError) {
            throw options.getError;
        }
        return createModelResponse();
    });
    return { headUrls, getUrls };
}

describe('本地模型下载的镜像回退', () => {
    let tmpRoot: string;
    let runtime: ExposedLocalAiRuntime;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashplayer-local-ai-'));
        runtime = new ExposedLocalAiRuntime(
            new FixedStorageDirectoryProvider(tmpRoot),
            new NoopRendererGateway(),
            {} as unknown as SettingsStore,
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    /** 已安装模型文件的真实路径：媒体库 models 目录下的 <模型 id>/<文件>。 */
    function installedModelPath(): string {
        return path.join(tmpRoot, TEST_MODEL.id, TEST_MODEL.file);
    }

    it('两个下载源都可达时优先使用声明的第一个源', async () => {
        const { getUrls } = mockFetchRoutes({ reachableUrls: [PRIMARY_URL, BACKUP_URL] });

        await runtime.installForTest(TEST_MODEL, new AbortController().signal);

        expect(getUrls).toEqual([PRIMARY_URL]);
        expect(fs.readFileSync(installedModelPath(), 'utf-8')).toBe(MODEL_BODY);
    });

    it('第一个源不可达时自动改用备用源下载且通过 SHA256 校验', async () => {
        const { getUrls } = mockFetchRoutes({ reachableUrls: [BACKUP_URL] });

        await runtime.installForTest(TEST_MODEL, new AbortController().signal);

        expect(getUrls).toEqual([BACKUP_URL]);
        expect(fs.readFileSync(installedModelPath(), 'utf-8')).toBe(MODEL_BODY);
    });

    it('全部地址不可达时下载报错且不静默成功', async () => {
        mockFetchRoutes({ reachableUrls: [], getError: new Error('ECONNREFUSED: 网络不可达') });

        await expect(runtime.installForTest(TEST_MODEL, new AbortController().signal))
            .rejects.toThrow('ECONNREFUSED');
        expect(fs.existsSync(installedModelPath())).toBe(false);
    });

    it('只有一个下载源时不发起探测，直接使用该地址', async () => {
        const { headUrls, getUrls } = mockFetchRoutes({ reachableUrls: [] });
        const singleSourceModel: LocalAiModelDefinition = { ...TEST_MODEL, urls: [BACKUP_URL] };

        await runtime.installForTest(singleSourceModel, new AbortController().signal);

        expect(headUrls).toHaveLength(0);
        expect(getUrls).toEqual([BACKUP_URL]);
        expect(fs.readFileSync(installedModelPath(), 'utf-8')).toBe(MODEL_BODY);
    });
});
