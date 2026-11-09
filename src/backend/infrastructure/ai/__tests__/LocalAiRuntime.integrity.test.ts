import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PassThrough, Readable } from 'stream';
import { LocalAiRuntime, LOCAL_AI_INTEGRITY_MARKER_SUFFIX } from '@/backend/infrastructure/ai/LocalAiRuntime';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type { LocalAiModelDefinition } from '@/common/contracts/local-ai';

// LocalAiRuntime 的 import 链经 runtimeEnv 依赖 electron（读取 isPackaged），
// vitest 下必须 mock，与同目录的下载镜像测试约定一致。
vi.mock('electron', () => ({
    app: { isPackaged: false, getVersion: () => 'test', getPath: () => '/tmp/dashplayer-local-ai-integrity-test-userdata' },
    shell: { openPath: vi.fn() },
}));

// 字符串常量供 mock 工厂与测试断言共用；vi.mock 工厂会被提升，无法引用普通顶层变量。
const { MODEL_BODY, MODEL_URL } = vi.hoisted(() => ({
    MODEL_BODY: 'gguf-model-content',
    MODEL_URL: 'https://modelscope.example.com/integrity-test.gguf',
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
        sizeLabel: '~18 B',
        urls: [MODEL_URL],
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

/**
 * 与正确内容等长但字节不同的“同尺寸损坏文件”。
 *
 * 体积相同是这里的关键：只有体积校验的实现会被它骗过去。
 */
const CORRUPT_BODY = 'X'.repeat(MODEL_BODY.length);

/** 固定的修改时间，保证标记文件里的 mtimeMs 能被精确还原。 */
const FIXED_TIME = new Date('2026-01-01T00:00:00.000Z');

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

/** 设置存储测试替身：本地引擎一律视为未启用。 */
const settingsStore = {
    get: () => undefined,
    set: () => true,
} as unknown as SettingsStore;

/** 暴露受保护 install 方法的运行时子类，便于直接测试安装链路的完整性校验。 */
class ExposedLocalAiRuntime extends LocalAiRuntime {
    public installForTest(model: LocalAiModelDefinition, signal: AbortSignal): Promise<void> {
        return this.install(model, signal);
    }
}

/** 构造一次性写完模型测试体的流式 HTTP 响应。 */
function createModelResponse(): Response {
    const stream = new PassThrough();
    setTimeout(() => {
        stream.write(MODEL_BODY);
        stream.end();
    }, 0);
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, { status: 200, statusText: 'OK' });
}

describe('本地模型文件的 SHA256 完整性校验', () => {
    let tmpRoot: string;
    let runtime: ExposedLocalAiRuntime;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashplayer-local-ai-integrity-'));
        runtime = new ExposedLocalAiRuntime(
            new FixedStorageDirectoryProvider(tmpRoot),
            new NoopRendererGateway(),
            settingsStore,
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

    /** 完整性标记文件路径。 */
    function markerPath(): string {
        return `${installedModelPath()}${LOCAL_AI_INTEGRITY_MARKER_SUFFIX}`;
    }

    /** 写入一份指定内容的“已安装”模型文件，并固定其修改时间。 */
    function writeInstalledModel(content: string): void {
        const modelPath = installedModelPath();
        fs.mkdirSync(path.dirname(modelPath), { recursive: true });
        fs.writeFileSync(modelPath, content);
        fs.utimesSync(modelPath, FIXED_TIME, FIXED_TIME);
    }

    /** 覆盖模型文件内容（不还原修改时间，等价于文件被替换）。 */
    function corruptInstalledModel(content: string): void {
        fs.writeFileSync(installedModelPath(), content);
    }

    it('已安装但内容损坏的模型文件被校验拦截并删除', async () => {
        writeInstalledModel(CORRUPT_BODY);

        await expect(runtime.installForTest(TEST_MODEL, new AbortController().signal))
            .rejects.toThrow('SHA256');
        expect(fs.existsSync(installedModelPath())).toBe(false);
        expect(fs.existsSync(markerPath())).toBe(false);
    });

    it('校验通过后写入标记文件，记录模型 id、摘要与文件状态', async () => {
        writeInstalledModel(MODEL_BODY);

        await runtime.installForTest(TEST_MODEL, new AbortController().signal);

        expect(fs.existsSync(markerPath())).toBe(true);
        const marker = JSON.parse(fs.readFileSync(markerPath(), 'utf-8'));
        expect(marker.modelId).toBe(TEST_MODEL.id);
        expect(marker.sha256).toBe(TEST_MODEL.sha256);
        expect(marker.size).toBe(TEST_MODEL.bytes);
        expect(marker.mtimeMs).toBe(FIXED_TIME.getTime());
    });

    it('标记与当前文件一致时复用校验结果，不再重新哈希', async () => {
        writeInstalledModel(MODEL_BODY);
        await runtime.installForTest(TEST_MODEL, new AbortController().signal);

        // 内容被改坏但体积与修改时间保持不变：命中标记，复用上次的校验结论。
        corruptInstalledModel(CORRUPT_BODY);
        fs.utimesSync(installedModelPath(), FIXED_TIME, FIXED_TIME);

        await expect(runtime.installForTest(TEST_MODEL, new AbortController().signal)).resolves.toBeUndefined();
        // 仍然是被改坏的内容，说明本轮没有重新哈希。
        expect(fs.readFileSync(installedModelPath(), 'utf-8')).toBe(CORRUPT_BODY);
    });

    it('文件被替换后标记失效，重新校验并拦截损坏文件', async () => {
        writeInstalledModel(MODEL_BODY);
        await runtime.installForTest(TEST_MODEL, new AbortController().signal);

        // 内容被改坏且修改时间变化：标记不再可信，必须重新哈希。
        corruptInstalledModel(CORRUPT_BODY);

        await expect(runtime.installForTest(TEST_MODEL, new AbortController().signal))
            .rejects.toThrow('SHA256');
        expect(fs.existsSync(installedModelPath())).toBe(false);
    });

    it('下载完成的新模型同样写入标记文件', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createModelResponse());

        await runtime.installForTest(TEST_MODEL, new AbortController().signal);

        expect(fs.readFileSync(installedModelPath(), 'utf-8')).toBe(MODEL_BODY);
        const marker = JSON.parse(fs.readFileSync(markerPath(), 'utf-8'));
        expect(marker.sha256).toBe(TEST_MODEL.sha256);
    });

    it('加载路径拒绝未经校验的模型文件', async () => {
        writeInstalledModel(CORRUPT_BODY);

        await expect(runtime.generateText('hello', TEST_MODEL.id)).rejects.toThrow('SHA256');
    });
});
