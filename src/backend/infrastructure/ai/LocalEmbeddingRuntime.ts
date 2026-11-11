import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { inject, injectable } from 'inversify';
import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';

import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { getRuntimeResourcePath } from '@/backend/utils/runtimeEnv';
import {
    LOCAL_EMBEDDING_DIMENSION,
    LOCAL_EMBEDDING_MODEL,
    LOCAL_EMBEDDING_MMPROJ,
    LLAMA_RUNTIME_VERSION,
} from '@/common/contracts/local-ai';
import { probeReachableDownloadUrl } from '@/backend/utils/probeDownloadUrl';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** 向量维度；EmbeddingGemma 2 固定 768 维，用于拒绝异常响应。 */
const EMBEDDING_DIMENSION = LOCAL_EMBEDDING_DIMENSION;

/** 单次请求最多提交的文本条数，避免一次把整部字幕塞进上下文。 */
const MAX_BATCH_SIZE = 32;

/** 单条文本最大字符数，超长文本截断而不是让服务端报错。 */
const MAX_TEXT_LENGTH = 512;

/** 空闲多久后卸载模型进程，避免长期占用内存。 */
const IDLE_UNLOAD_MS = 5 * 60 * 1000;

const embeddingResponseSchema = z.object({
    data: z.array(z.object({
        embedding: z.array(z.number()).length(EMBEDDING_DIMENSION),
    })).min(1),
});

/**
 * 本地语义向量运行时。
 *
 * 与对话模型完全隔离：独立的 llama-server 进程、独立的端口与生命周期。
 * 模型未安装、运行时不支持或推理失败时一律返回 `null`，由调用方降级为
 * 词面相似度；语义能力属于增强，不允许阻断内容推荐。
 */
@injectable()
export class LocalEmbeddingRuntime {
    private readonly logger = getMainLogger('LocalEmbeddingRuntime');
    private readonly directLoopbackAgent = new Agent();
    private child: ChildProcess | null = null;
    private endpoint: string | null = null;
    private starting: Promise<string | null> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor(
        @inject(TYPES.StorageDirectoryProvider) private readonly directories: StorageDirectoryProvider,
    ) {}

    /** 旧模型清理是否已执行；每次进程生命周期只做一次。 */
    private legacyCleanupDone = false;

    /**
     * 清理已废弃的 bge-small 模型文件（幂等，每个进程只执行一次）。
     *
     * 放在读取状态时触发而不是启动时集中执行：用户可能整年不开语义推荐，
     * 没必要为 37 MB 的清理阻塞启动；一旦用到语义能力，旧文件就该消失。
     *
     * @returns 是否确实删除了旧目录。
     */
    public async cleanupLegacyModel(): Promise<boolean> {
        if (this.legacyCleanupDone) {
            return false;
        }
        this.legacyCleanupDone = true;
        const legacy = await this.legacyModelPath();
        try {
            await fs.promises.rm(legacy, { recursive: true, force: true });
            return true;
        } catch (error) {
            this.logger.warn('legacy embedding model cleanup skipped', {
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    /** 模型文件的安装路径。 */
    private async modelPath(): Promise<string> {
        const directory = await this.directories.provideDirectory(StorageDirectoryTarget.MODELS);
        return path.join(directory, LOCAL_EMBEDDING_MODEL.id, LOCAL_EMBEDDING_MODEL.file);
    }

    /** 多模态投影文件的安装路径。 */
    private async mmprojPath(): Promise<string> {
        const directory = await this.directories.provideDirectory(StorageDirectoryTarget.MODELS);
        return path.join(directory, LOCAL_EMBEDDING_MMPROJ.id, LOCAL_EMBEDDING_MMPROJ.file);
    }

    /** 模型是否已完整安装；只做体积判断，哈希校验在下载时完成。 */
    public async isReady(): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(await this.modelPath());
            return stat.size === LOCAL_EMBEDDING_MODEL.bytes;
        } catch {
            return false;
        }
    }

    /**
     * 多模态投影是否已安装。
     *
     * 它是可选的：只有需要图像/音频向量时才安装，文本推荐不依赖它。
     */
    public async isMultimodalReady(): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(await this.mmprojPath());
            return stat.size === LOCAL_EMBEDDING_MMPROJ.bytes;
        } catch {
            return false;
        }
    }

    /** 语义模型状态：是否已安装、体积与模型名，供设置页展示。 */
    public async getStatus(): Promise<{
        ready: boolean;
        name: string;
        sizeLabel: string;
        bytes: number;
        /** 多模态投影是否就绪；未安装时图像/音频向量不可用。 */
        multimodalReady: boolean;
        /** 多模态投影体积，供设置页展示。 */
        multimodalBytes: number;
    }> {
        // 顺带清理旧模型：用户打开设置页或推荐页时就完成迁移，不必等到下次安装。
        void this.cleanupLegacyModel();
        return {
            ready: await this.isReady(),
            name: LOCAL_EMBEDDING_MODEL.name,
            sizeLabel: LOCAL_EMBEDDING_MODEL.sizeLabel,
            bytes: LOCAL_EMBEDDING_MODEL.bytes,
            multimodalReady: await this.isMultimodalReady(),
            multimodalBytes: LOCAL_EMBEDDING_MMPROJ.bytes,
        };
    }

    /**
     * 下载并安装可选的语义模型。
     *
     * 与对话模型下载互不影响：单独目录、单独进度，不占用对话模型的「正在下载」状态。
     *
     * @param onProgress 可选进度回调，参数为已下载字节数。
     * @returns 下载完成时为 true；失败抛错。
     */
    public async download(onProgress?: (downloaded: number) => void): Promise<void> {
        await this.downloadOne(
            LOCAL_EMBEDDING_MODEL,
            await this.modelPath(),
            onProgress,
        );
    }

    /**
     * 下载并安装多模态投影文件。
     *
     * 只有需要图像/音频向量时才需要它；文本推荐不依赖。
     *
     * @param onProgress 可选进度回调，参数为已下载字节数。
     */
    public async downloadMultimodal(onProgress?: (downloaded: number) => void): Promise<void> {
        await this.downloadOne(
            LOCAL_EMBEDDING_MMPROJ,
            await this.mmprojPath(),
            onProgress,
        );
    }

    /**
     * 下载并校验单个模型文件。
     *
     * 先写 `.part` 再校验体积与 SHA-256，校验通过才改名，避免半截文件被当成已安装。
     *
     * @param definition 模型定义（含体积、哈希与下载源）。
     * @param modelPath 目标路径。
     * @param onProgress 可选进度回调。
     */
    private async downloadOne(
        definition: typeof LOCAL_EMBEDDING_MODEL,
        modelPath: string,
        onProgress?: (downloaded: number) => void,
    ): Promise<void> {
        try {
            const stat = await fs.promises.stat(modelPath);
            if (stat.size === definition.bytes) {
                return;
            }
        } catch {
            // 文件不存在，继续下载。
        }
        await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
        const partialPath = `${modelPath}.part`;
        const controller = new AbortController();
        const url = await probeReachableDownloadUrl(definition.urls, controller.signal)
            ?? definition.urls[0];
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || !response.body) {
            throw new Error(`语义模型下载失败：HTTP ${response.status}`);
        }
        let downloaded = 0;
        const hash = createHash('sha256');
        const sink = fs.createWriteStream(partialPath);
        const source = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
        source.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            hash.update(chunk);
            onProgress?.(downloaded);
        });
        await pipeline(source, sink);
        if (downloaded !== definition.bytes || hash.digest('hex') !== definition.sha256) {
            await fs.promises.rm(partialPath, { force: true });
            throw new Error('语义模型校验失败，请重试');
        }
        await fs.promises.rename(partialPath, modelPath);
    }

    /**
     * 删除已安装的语义模型与多模态投影。
     *
     * 先停进程再删文件：Windows 下运行中的文件无法删除。
     *
     * @returns 实际删除的文件数。
     */
    public async remove(): Promise<number> {
        await this.shutdown();
        let removed = 0;
        for (const target of [await this.modelPath(), await this.mmprojPath()]) {
            try {
                await fs.promises.rm(target, { force: true });
                removed += 1;
            } catch {
                // 文件本就不存在时忽略。
            }
        }
        return removed;
    }

    /**
     * 旧的 bge-small 模型目录，用于升级清理。
     *
     * 用户从旧版本升级后，旧模型文件会一直占着 37 MB；这里显式列出并在
     * 启动时清理，避免「已移除但磁盘上还在」。
     */
    private async legacyModelPath(): Promise<string> {
        const directory = await this.directories.provideDirectory(StorageDirectoryTarget.MODELS);
        return path.join(directory, 'bge-small-en-v1.5-q8_0');
    }

    /**
     * 批量生成语义向量。
     *
     * @param texts 待向量化文本；空数组直接返回空结果。
     * @returns 与输入顺序一致的向量；模型不可用或请求失败时为 `null`。
     */
    public async embed(texts: readonly string[]): Promise<number[][] | null> {
        if (texts.length === 0) {
            return [];
        }
        const endpoint = await this.ensureStarted();
        if (!endpoint) {
            return null;
        }
        this.touch();
        const normalized = texts.map((text) => text.trim().slice(0, MAX_TEXT_LENGTH));
        const batches: number[][][] = [];
        for (let offset = 0; offset < normalized.length; offset += MAX_BATCH_SIZE) {
            const batch = normalized.slice(offset, offset + MAX_BATCH_SIZE);
            const response = await this.requestBatch(endpoint, batch);
            if (!response) {
                return null;
            }
            batches.push(response);
        }
        return batches.flat();
    }

    /**
     * 批量生成图像向量。
     *
     * 需要多模态投影（mmproj）已安装；未安装时返回 `null`，由调用方跳过帧理解，
     * 而不是把「没有视觉能力」伪装成零向量。
     *
     * @param images 图像字节（JPEG/PNG）与 MIME 类型。
     * @returns 与输入顺序一致的向量；不可用时为 `null`。
     */
    public async embedImages(
        images: ReadonlyArray<{ data: Buffer; mimeType: string }>,
    ): Promise<number[][] | null> {
        if (images.length === 0) {
            return [];
        }
        if (!await this.isMultimodalReady()) {
            return null;
        }
        const endpoint = await this.ensureStarted();
        if (!endpoint) {
            return null;
        }
        this.touch();
        const results: number[][] = [];
        for (const image of images) {
            const vector = await this.requestImageEmbedding(endpoint, image);
            if (!vector) {
                return null;
            }
            results.push(vector);
        }
        return results;
    }

    /** 停止模型进程；应用退出或显式卸载时调用。 */
    public async shutdown(): Promise<void> {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        const child = this.child;
        this.child = null;
        this.endpoint = null;
        this.starting = null;
        if (child && !child.killed) {
            child.kill();
        }
    }

    /**
     * 惰性启动：并发调用共享同一个启动 Promise，失败后允许下次重试。
     */
    private async ensureStarted(): Promise<string | null> {
        if (this.endpoint) {
            return this.endpoint;
        }
        if (this.starting) {
            return this.starting;
        }
        this.starting = this.start();
        try {
            return await this.starting;
        } finally {
            this.starting = null;
        }
    }

    private async start(): Promise<string | null> {
        if (!await this.isReady()) {
            this.logger.debug('embedding model not installed, skip semantic index');
            return null;
        }
        const runtimePath = this.runtimePath();
        if (!fs.existsSync(runtimePath)) {
            this.logger.warn('embedding runtime missing, skip semantic index', { runtimePath });
            return null;
        }
        const port = await this.reservePort();
        if (!port) {
            return null;
        }
        const args = [
            '--model', await this.modelPath(),
            '--host', '127.0.0.1',
            '--port', String(port),
            '--embeddings',
            '--pooling', 'mean',
            '--ctx-size', '512',
            '--n-gpu-layers', '0',
            '--no-webui',
        ];
        // 多模态投影只在已安装时挂载：未安装时纯文本向量照常工作，
        // 不会因为缺文件而让整个语义能力不可用。
        if (await this.isMultimodalReady()) {
            args.push('--mmproj', await this.mmprojPath());
        }
        const child = spawn(runtimePath, args, {
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        this.child = child;
        const failureRef: { current: Error | null } = { current: null };
        child.once('error', (error) => {
            failureRef.current = error;
        });
        child.once('close', (code) => {
            if (this.child === child) {
                this.child = null;
                this.endpoint = null;
            }
            failureRef.current = failureRef.current ?? new Error(`本地向量进程退出：${code}`);
        });
        const endpoint = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (failureRef.current) {
                this.logger.warn('embedding runtime failed to start', { error: failureRef.current.message });
                await this.shutdown();
                return null;
            }
            try {
                const response = await undiciFetch(`${endpoint}/health`, {
                    dispatcher: this.directLoopbackAgent,
                    signal: AbortSignal.timeout(1_000),
                });
                if (response.ok) {
                    this.endpoint = endpoint;
                    return endpoint;
                }
                await response.body?.cancel();
            } catch {
                // 模型仍在加载，继续等待。
            }
            await delay(250);
        }
        this.logger.warn('embedding runtime start timed out');
        await this.shutdown();
        return null;
    }

    private async requestBatch(endpoint: string, batch: string[]): Promise<number[][] | null> {
        try {
            const response = await undiciFetch(`${endpoint}/v1/embeddings`, {
                method: 'POST',
                dispatcher: this.directLoopbackAgent,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: batch }),
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) {
                await response.body?.cancel();
                this.logger.warn('embedding request failed', { status: response.status });
                return null;
            }
            const parsed = embeddingResponseSchema.safeParse(await response.json());
            if (!parsed.success || parsed.data.data.length !== batch.length) {
                this.logger.warn('embedding response invalid');
                return null;
            }
            return parsed.data.data.map((item) => item.embedding);
        } catch (error) {
            this.logger.warn('embedding request error', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * 请求单张图像的向量。
     *
     * llama-server 的多模态 embedding 用 `content` 数组表达一条输入
     * （`{ content: [{ type: 'image_url', ... }] }`），而不是 OpenAI 的
     * `{ type: 'image_url' }` 顶层项；后者会被当成非法 prompt 拒绝。
     * 解析与文本共用同一套维度校验，维度不符即视为失败并降级。
     */
    private async requestImageEmbedding(
        endpoint: string,
        image: { data: Buffer; mimeType: string },
    ): Promise<number[] | null> {
        try {
            const response = await undiciFetch(`${endpoint}/v1/embeddings`, {
                method: 'POST',
                dispatcher: this.directLoopbackAgent,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: [{
                        content: [{
                            type: 'image_url',
                            image_url: {
                                url: `data:${image.mimeType};base64,${image.data.toString('base64')}`,
                            },
                        }],
                    }],
                }),
                signal: AbortSignal.timeout(30_000),
            });
            if (!response.ok) {
                await response.body?.cancel();
                this.logger.warn('image embedding request failed', { status: response.status });
                return null;
            }
            const parsed = embeddingResponseSchema.safeParse(await response.json());
            if (!parsed.success || parsed.data.data.length !== 1) {
                this.logger.warn('image embedding response invalid');
                return null;
            }
            return parsed.data.data[0].embedding;
        } catch (error) {
            this.logger.warn('image embedding request error', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /** 每次成功请求后重置空闲计时；到期后主动卸载，下次按需重启。 */
    private touch(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => {
            this.logger.debug('embedding runtime idle unload');
            void this.shutdown();
        }, IDLE_UNLOAD_MS);
        this.idleTimer.unref?.();
    }

    private runtimePath(): string {
        const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
        return getRuntimeResourcePath(
            'lib',
            'llama',
            LLAMA_RUNTIME_VERSION,
            `${process.platform}-${process.arch}`,
            exeName,
        );
    }

    private async reservePort(): Promise<number | null> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.unref();
            server.on('error', () => resolve(null));
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    server.close(() => resolve(null));
                    return;
                }
                const { port } = address;
                server.close(() => resolve(port));
            });
        });
    }
}
