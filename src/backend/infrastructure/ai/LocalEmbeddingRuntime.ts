import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
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
import { LOCAL_AI_INTEGRITY_MARKER_SUFFIX } from './LocalModelInstaller';
import { probeReachableDownloadUrl } from '@/backend/utils/probeDownloadUrl';
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
    private childExit: Promise<void> | null = null;
    private endpoint: string | null = null;
    private starting: Promise<string | null> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    /** 生命周期代数：shutdown 会递增，start 的健康轮询据此放弃被叫停的启动。 */
    private generation = 0;
    /** 与推理侧一致的随机鉴权密钥：本机其它进程不能无凭据调用向量接口。 */
    private readonly apiKey = randomBytes(32).toString('hex');
    /** 进行中的下载任务；同一时间只允许一个，防止双写 .part 互相覆写。 */
    private downloadTask: Promise<void> | null = null;
    /** 当前下载任务的取消控制器；remove() 删除模型前可先中止在途写入。 */
    private downloadController: AbortController | null = null;

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

    /** 模型是否已完整安装；只做体积判断，哈希校验在下载与加载时完成。 */
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

    /** 计算文件的 SHA256 摘要；按流读取，避免整块载入内存。 */
    private async sha256File(file: string, signal?: AbortSignal): Promise<string> {
        const hash = createHash('sha256');
        const stream = fs.createReadStream(file, signal ? { signal } : {});
        for await (const chunk of stream) hash.update(chunk);
        return hash.digest('hex');
    }

    /**
     * 校验已安装模型文件的 SHA256 完整性，结论记忆在 `.sha256.ok` 标记里。
     *
     * 与推理侧同一威胁模型：只比对字节数分不清「完整」与「恰好同尺寸的损坏
     * 文件」。摘要不符时删除损坏文件并抛错，避免它继续被当成已安装。
     *
     * @param definition 模型定义（含期望摘要）。
     * @param filePath 模型文件路径。
     */
    private async verifyModelIntegrity(
        definition: typeof LOCAL_EMBEDDING_MODEL,
        filePath: string,
    ): Promise<void> {
        const markerPath = `${filePath}${LOCAL_AI_INTEGRITY_MARKER_SUFFIX}`;
        const stat = await fs.promises.stat(filePath);
        try {
            const raw = await fs.promises.readFile(markerPath, 'utf-8');
            const marker = JSON.parse(raw) as { sha256?: string; size?: number; mtimeMs?: number };
            if (marker.sha256 === definition.sha256
                && marker.size === stat.size && marker.mtimeMs === stat.mtimeMs) {
                return;
            }
        } catch {
            // 标记缺失或损坏都按「需要重新校验」处理。
        }
        const digest = await this.sha256File(filePath);
        if (digest !== definition.sha256) {
            await fs.promises.rm(markerPath, { force: true });
            await fs.promises.rm(filePath, { force: true });
            throw new Error(`语义模型「${definition.name}」SHA256 校验失败，文件已损坏并被删除，请重新下载`);
        }
        try {
            await fs.promises.writeFile(markerPath, JSON.stringify({
                modelId: definition.id,
                sha256: definition.sha256,
                size: stat.size,
                mtimeMs: stat.mtimeMs,
            }), 'utf-8');
        } catch (error) {
            this.logger.warn('embedding integrity marker write failed', { filePath, error });
        }
    }

    /**
     * 下载并安装可选的语义模型。
     *
     * 与对话模型下载互不影响：单独目录、单独进度，不占用对话模型的「正在下载」状态。
     * 同一时间只允许一个语义模型下载任务（含多模态投影），防止两个写入器
     * 互相覆写 `.part` 后产出「通过校验」的损坏模型。
     *
     * @param onProgress 可选进度回调，参数为已下载字节数。
     * @returns 下载完成时为 true；失败抛错。
     */
    public async download(onProgress?: (downloaded: number) => void): Promise<void> {
        await this.runExclusiveDownload(async (signal) => this.downloadOne(
            LOCAL_EMBEDDING_MODEL,
            await this.modelPath(),
            signal,
            onProgress,
        ));
    }

    /**
     * 下载并安装多模态投影文件。
     *
     * 只有需要图像/音频向量时才需要它；文本推荐不依赖。
     *
     * @param onProgress 可选进度回调，参数为已下载字节数。
     */
    public async downloadMultimodal(onProgress?: (downloaded: number) => void): Promise<void> {
        await this.runExclusiveDownload(async (signal) => this.downloadOne(
            LOCAL_EMBEDDING_MMPROJ,
            await this.mmprojPath(),
            signal,
            onProgress,
        ));
    }

    /** 串行执行下载任务；进行中再发起直接拒绝。 */
    private async runExclusiveDownload(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
        if (this.downloadTask) {
            throw new Error('语义模型正在下载，请等待完成后再试');
        }
        const controller = new AbortController();
        this.downloadController = controller;
        const running = task(controller.signal);
        this.downloadTask = running;
        try {
            await running;
        } finally {
            if (this.downloadTask === running) {
                this.downloadTask = null;
            }
            if (this.downloadController === controller) {
                this.downloadController = null;
            }
        }
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
        signal: AbortSignal,
        onProgress?: (downloaded: number) => void,
    ): Promise<void> {
        try {
            const stat = await fs.promises.stat(modelPath);
            if (stat.size === definition.bytes) {
                // 同尺寸文件不能只看体积：损坏文件会被当成已安装继续使用。
                // 校验失败（文件已被删除）时继续走重新下载，而不是把错误抛给用户。
                try {
                    await this.verifyModelIntegrity(definition, modelPath);
                    return;
                } catch {
                    // 继续下载。
                }
            }
        } catch {
            // 文件不存在，继续下载。
        }
        await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
        const partialPath = `${modelPath}.part`;
        const url = await probeReachableDownloadUrl(definition.urls, signal)
            ?? definition.urls[0];
        const response = await fetch(url, { signal });
        if (!response.ok || !response.body) {
            throw new Error(`语义模型下载失败：HTTP ${response.status}`);
        }
        let downloaded = 0;
        const sink = fs.createWriteStream(partialPath);
        const source = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
        source.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            onProgress?.(downloaded);
        });
        await pipeline(source, sink, { signal });
        // 校验必须重读落盘文件而不是在下载流上顺手累积：并发写入器写过同一
        // `.part` 时，流哈希对应的是自己流过的字节，磁盘上可能是另一个写入器的
        // 数据。体积也以落盘为准。
        if (await this.sha256File(partialPath) !== definition.sha256
            || await new Promise<number>((resolve, reject) => {
                fs.stat(partialPath, (error, stat) => error ? reject(error) : resolve(stat.size));
            }) !== definition.bytes) {
            await fs.promises.rm(partialPath, { force: true });
            throw new Error('语义模型校验失败，请重试');
        }
        await fs.promises.rename(partialPath, modelPath);
        try {
            await this.verifyModelIntegrity(definition, modelPath);
        } catch (error) {
            // 下载链路已做落盘哈希校验，这里失败属于异常状态：清掉刚装的文件，
            // 保持「已安装即可用」的约定。
            await fs.promises.rm(modelPath, { force: true });
            throw error;
        }
    }

    /**
     * 删除已安装的语义模型与多模态投影。
     *
     * 先停进程（等待真正退出）再删文件：Windows 下运行中的文件无法删除，
     * 只发 SIGTERM 不等待会在 Windows 上静默删不掉。续传残留与完整性标记一并清理。
     *
     * @returns 实际删除的文件数。
     */
    public async remove(): Promise<number> {
        this.downloadController?.abort();
        await this.downloadTask?.catch(() => undefined);
        await this.shutdown();
        let removed = 0;
        for (const target of [await this.modelPath(), await this.mmprojPath()]) {
            try {
                await fs.promises.rm(target, { force: true });
                removed += 1;
            } catch {
                // 文件本就不存在时忽略。
            }
            await fs.promises.rm(`${target}.part`, { force: true }).catch(() => undefined);
            await fs.promises.rm(`${target}${LOCAL_AI_INTEGRITY_MARKER_SUFFIX}`, { force: true }).catch(() => undefined);
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
        if (!endpoint || this.endpoint !== endpoint) {
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
        if (!endpoint || this.endpoint !== endpoint) {
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

    private async terminateChildProcess(child: ChildProcess, exited: Promise<void> | null): Promise<void> {
        if (this.child === child) {
            this.child = null;
            this.endpoint = null;
            this.childExit = null;
        }
        child.kill();
        const forceTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
        try {
            await exited;
        } finally {
            clearTimeout(forceTimer);
        }
        this.logger.info('embedding runtime stopped', { pid: child.pid });
    }

    /**
     * 停止模型进程；应用退出、空闲卸载或显式删除时调用。
     *
     * 等待子进程真正退出（3 秒后强制 SIGKILL）：Windows 下不等待就删文件会
     * 静默失败；应用退出链也依赖 shutdown 完成后不再留进程。
     */
    public async shutdown(): Promise<void> {
        this.generation += 1;
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        const child = this.child;
        const exited = this.childExit;
        this.child = null;
        this.endpoint = null;
        this.starting = null;
        this.childExit = null;
        if (!child) {
            return;
        }
        await this.terminateChildProcess(child, exited);
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
        // 生命周期代数：本代启动若被 shutdown 叫停，必须停止并清理已启动进程。
        const generation = ++this.generation;
        if (!await this.isReady() || generation !== this.generation) {
            this.logger.debug('embedding model not installed, skip semantic index');
            return null;
        }
        // 加载前强制完整性校验：同尺寸的损坏文件不得进入推理进程。
        // 校验失败（损坏文件已被删除）按不可用降级，语义推荐回到词面相似度。
        const modelPath = await this.modelPath();
        try {
            await this.verifyModelIntegrity(LOCAL_EMBEDDING_MODEL, modelPath);
        } catch (error) {
            this.logger.warn('embedding model integrity check failed', { error });
            return null;
        }
        if (generation !== this.generation) {
            return null;
        }
        const runtimePath = this.runtimePath();
        if (!fs.existsSync(runtimePath)) {
            this.logger.warn('embedding runtime missing, skip semantic index', { runtimePath });
            return null;
        }
        const port = await this.reservePort();
        if (!port || generation !== this.generation) {
            return null;
        }
        const args = [
            '--model', modelPath,
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
            try {
                await this.verifyModelIntegrity(LOCAL_EMBEDDING_MMPROJ, await this.mmprojPath());
            } catch (error) {
                this.logger.warn('embedding mmproj integrity check failed, skip multimodal', { error });
                await fs.promises.rm(await this.mmprojPath(), { force: true }).catch(() => undefined);
            }
            if (await this.isMultimodalReady()) {
                args.push('--mmproj', await this.mmprojPath());
            }
        }
        if (generation !== this.generation) {
            return null;
        }
        const child = spawn(runtimePath, args, {
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe'],
            env: { ...process.env, LLAMA_API_KEY: this.apiKey },
        });
        this.child = child;
        const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
        this.childExit = exited;
        const failureRef: { current: Error | null } = { current: null };
        child.once('error', (error) => {
            failureRef.current = error;
        });
        child.once('close', (code) => {
            if (this.child === child) {
                this.child = null;
                this.endpoint = null;
                this.childExit = null;
            }
            failureRef.current = failureRef.current ?? new Error(`本地向量进程退出：${code}`);
        });
        const endpoint = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (generation !== this.generation) {
                // 启动期间被 shutdown 叫停：显式杀掉刚 spawn 的子进程，防止孤儿进程驻留。
                await this.terminateChildProcess(child, exited);
                return null;
            }
            if (failureRef.current) {
                this.logger.warn('embedding runtime failed to start', { error: failureRef.current.message });
                await this.terminateChildProcess(child, exited);
                return null;
            }
            try {
                const response = await undiciFetch(`${endpoint}/health`, {
                    dispatcher: this.directLoopbackAgent,
                    signal: AbortSignal.timeout(1_000),
                    headers: { Authorization: `Bearer ${this.apiKey}` },
                });
                if (response.ok) {
                    if (generation !== this.generation) {
                        await this.terminateChildProcess(child, exited);
                        return null;
                    }
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
        await this.terminateChildProcess(child, exited);
        return null;
    }

    private async requestBatch(endpoint: string, batch: string[]): Promise<number[][] | null> {
        try {
            const response = await undiciFetch(`${endpoint}/v1/embeddings`, {
                method: 'POST',
                dispatcher: this.directLoopbackAgent,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
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
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
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
