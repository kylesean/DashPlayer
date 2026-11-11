import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { Agent, fetch as undiciFetch } from 'undici';
import { getRuntimeResourcePath } from '@/backend/utils/runtimeEnv';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { LocalAiModelDefinition } from '@/common/contracts/local-ai';

/**
 * llama-server 并行 slot 数，与并发内核 localAi 信号量容量保持一致。
 *
 * 字幕翻译按 5 句一组整批发送，多组请求可并发发出，多 slot 借助
 * llama.cpp 连续批处理在一次解码中交织多条序列。
 * 总上下文需按 slot 均分：16384 / 4 = 每 slot 4096，容纳约 500 prompt
 * + 2048 输出上限，不会触发 slot 内截断。
 */
const LOCAL_PARALLEL_SLOTS = 4;
/** llama-server 总上下文 = slot 数 × 每 slot 上下文（见 LOCAL_PARALLEL_SLOTS）。 */
const LOCAL_TOTAL_CTX = 16384;

/**
 * 应用私有的 llama-server 子进程：按需拉起、共享给并发生成、统一终结。
 *
 * 从 LocalAiRuntime 拆出的用意：子进程与回环 HTTP 的生命周期（冷启动去重、
 * 健康轮询、异常退出清理、直连绕代理）是一块自洽的底层设施，编排层
 * （忙时计数、空闲卸载、测速）通过它发起生成而不必知道进程细节。
 *
 * 模型文件的体积与完整性校验经依赖注入由 LocalModelInstaller 提供，
 * 加载前仍强制校验，损坏文件不得进入推理进程。
 */
export class LlamaServerProcess {
    private readonly logger = getMainLogger('LlamaServerProcess');
    private child: ChildProcess | null = null;
    private childExit: Promise<void> | null = null;
    private endpoint: string | null = null;
    private loadedPath: string | null = null;
    private startInFlight: { modelPath: string; promise: Promise<string> } | null = null;
    private readonly apiKey = randomBytes(32).toString('hex');
    /** 仅用于连接本机回环 `127.0.0.1` 推理端口的直连客户端，绕过全局代理。 */
    private readonly directLoopbackAgent = new Agent();

    constructor(
        private readonly deps: {
            /** 应用生命周期信号：共享冷启动以此为整体取消边界。 */
            lifetimeSignal: AbortSignal;
            /** 解析模型在媒体库中的安装路径。 */
            resolveModelPath: (model: LocalAiModelDefinition) => Promise<string>;
            /** 查询文件大小。 */
            fileSize: (file: string) => Promise<number>;
            /** 模型完整性校验（SHA256 + 标记缓存），加载前强制执行。 */
            verifyIntegrity: (model: LocalAiModelDefinition, modelPath: string, signal?: AbortSignal) => Promise<void>;
        }
    ) {}

    /** 只使用明确支持的平台包；缺失的运行时由设置页显式展示。Windows 可执行文件带 .exe 后缀。 */
    private runtimePath(): string {
        const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
        return getRuntimeResourcePath('lib', 'llama', 'b10819', `${process.platform}-${process.arch}`, exeName);
    }

    /**
     * 是否启用 GPU 推理：Apple Silicon 走 Metal；其余平台看安装的运行包是否
     * 附带 Vulkan 后端库（download.mjs 在 linux/win32-x64 装 Vulkan 包，
     * win32-arm64 装 CPU 包）。GPU 层数与运行包形态由安装侧决定，运行时
     * 按包内容自适应，同一套代码无需平台分支。
     */
    private async gpuEnabled(): Promise<boolean> {
        if (process.platform === 'darwin') return process.arch === 'arm64';
        const dir = path.dirname(this.runtimePath());
        const vulkanBackends = ['libggml-vulkan.so', 'ggml-vulkan.dll'];
        for (const name of vulkanBackends) {
            try {
                await fs.promises.access(path.join(dir, name));
                return true;
            } catch {
                // 尝试下一个候选文件名。
            }
        }
        return false;
    }

    /**
     * 运行时是否就绪：以安装脚本写入的 .complete 标记为准。
     *
     * 依赖库清单由 scripts/download.mjs 在安装时校验并写入标记，运行时侧不重复
     * 复刻清单，避免两份列表漂移后各自判定不一致。
     */
    private async runtimeMarkerReady(): Promise<boolean> {
        try {
            const entries = await fs.promises.readdir(path.dirname(this.runtimePath()));
            return entries.includes('.complete');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
        }
    }

    /** 返回完整的运行时就绪判断：可执行文件存在且安装标记完整。 */
    public async runtimeReady(): Promise<boolean> {
        return await this.deps.fileSize(this.runtimePath()) > 0 && await this.runtimeMarkerReady();
    }

    /**
     * 自愈 llama.cpp linux 运行包缺失的 SONAME 别名（libllama.so.0.4.0 → libllama.so.0）。
     *
     * 官方发行包不再内含 .so.0 别名符号链接，而动态链接器按 SONAME 查找；
     * 缺别名时 llama-server 启动即报 "cannot open shared object file"。
     * 新装由 scripts/download.mjs 补齐；这里幂等补一次，覆盖从不重跑
     * 下载脚本的存量安装。
     */
    private async ensureSonameAliases(): Promise<void> {
        if (process.platform === 'win32' || process.platform === 'darwin') return;
        const dir = path.dirname(this.runtimePath());
        let entries: string[];
        try {
            entries = await fs.promises.readdir(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const match = entry.match(/^(.+)\.so\.\d+\.\d+\.\d+$/);
            if (!match) continue;
            const alias = path.join(dir, `${match[1]}.so.0`);
            try {
                await fs.promises.symlink(entry, alias);
                this.logger.info('runtime soname alias created', { alias, target: entry });
            } catch (error) {
                // 别名已存在（EEXIST）属预期；其余错误交由真实启动显式暴露。
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                    this.logger.warn('runtime soname alias creation failed', { alias, error });
                }
            }
        }
    }

    /** 申请回环动态端口；进程绑定失败会显式报告，不连接其他本地服务。 */
    private async reservePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') { server.close(); reject(new Error('无法申请本地推理端口')); return; }
                server.close((error) => error ? reject(error) : resolve(address.port));
            });
        });
    }

    /**
     * 判断加载轮询中捕获的错误是否属于“进程仍在启动”的可重试状态。
     *
     * @param error 健康检查请求抛出的异常。
     * @param loadingSignal 整体加载周期信号（外部取消或总超时已触发时不再视作预热中）。
     * @returns 仍可重试时返回 `true`。
     */
    private static isRuntimeWarmingUp(error: unknown, loadingSignal: AbortSignal): boolean {
        if (loadingSignal.aborted || !(error instanceof Error)) {
            return false;
        }
        if (error.name === 'TimeoutError') {
            return true;
        }
        const status = (error as { status?: number }).status;
        if (status === 503) {
            return true;
        }
        const directCode = (error as { code?: string }).code;
        const causeCode = (error.cause as { code?: string } | undefined)?.code;
        const code = directCode ?? causeCode;
        return code === 'ECONNREFUSED'
            || code === 'ECONNABORTED'
            || code === 'ECONNRESET'
            || code === 'UND_ERR_CONNECT_TIMEOUT';
    }

    /** 允许单个等待者在自身 signal 取消时提前退出，而不中断其他并发请求共享的冷启动。 */
    private async awaitWithCallerSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
        signal.throwIfAborted();
        return await new Promise<T>((resolve, reject) => {
            const onAbort = () => {
                reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            promise.then(
                (value) => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(value);
                },
                (error) => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                },
            );
        });
    }

    /** 子进程是否仍在运行。 */
    public isRunning(): boolean {
        return this.child !== null;
    }

    /** 指定路径的模型是否已加载在当前子进程中。 */
    public isLoadedModel(modelPath: string): boolean {
        return this.child !== null && this.loadedPath === modelPath;
    }

    /** 按需加载模型，使用随机鉴权密钥并等待就绪；并发冷启动共享同一启动流程，加载失败会结束子进程。 */
    public async start(model: LocalAiModelDefinition, signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        const modelPath = await this.deps.resolveModelPath(model);
        if (this.endpoint && this.loadedPath === modelPath && this.child) return this.endpoint;

        while (this.startInFlight) {
            if (this.startInFlight.modelPath === modelPath) {
                return await this.awaitWithCallerSignal(this.startInFlight.promise, signal);
            }
            await this.awaitWithCallerSignal(
                this.startInFlight.promise.catch(() => ''),
                signal,
            );
            if (this.endpoint && this.loadedPath === modelPath && this.child) return this.endpoint;
        }

        const promise = this.doStart(model, modelPath, this.deps.lifetimeSignal)
            .finally(() => {
                if (this.startInFlight?.promise === promise) {
                    this.startInFlight = null;
                }
            });
        this.startInFlight = { modelPath, promise };
        return await this.awaitWithCallerSignal(promise, signal);
    }

    /** 实际执行模型完整性校验与 llama-server 进程拉起。 */
    private async doStart(model: LocalAiModelDefinition, modelPath: string, signal: AbortSignal): Promise<string> {
        await this.stop();
        if (await this.deps.fileSize(modelPath) !== model.bytes) {
            throw new Error(`本地模型「${model.name}」未安装，请前往设置-服务凭据下载`);
        }
        // 加载前必须通过完整性校验：同尺寸的损坏文件不得进入推理进程。
        await this.deps.verifyIntegrity(model, modelPath, signal);
        if (!(await this.runtimeReady())) {
            throw new Error('llama.cpp 运行时缺失，请重新执行 yarn run download 或重新安装应用');
        }
        await this.ensureSonameAliases();
        const port = await this.reservePort();
        signal.throwIfAborted();
        const endpoint = `http://127.0.0.1:${port}`;
        const gpuRequested = await this.gpuEnabled();
        const child = spawn(this.runtimePath(), [
            '--model', modelPath, '--host', '127.0.0.1', '--port', String(port),
            '--ctx-size', String(LOCAL_TOTAL_CTX), '--parallel', String(LOCAL_PARALLEL_SLOTS), '--jinja', '--no-webui',
            '--chat-template-kwargs', '{"enable_thinking":false}', '--reasoning-budget', '0',
            // 带后端库时把全部层放进 GPU；纯 CPU 包传 0 保持纯 CPU 推理。
            '--n-gpu-layers', gpuRequested ? '99' : '0',
        ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, LLAMA_API_KEY: this.apiKey } });
        this.child = child;
        let failure: Error | null = null;
        const stderrTail: string[] = [];
        child.stderr?.on('data', (chunk: Buffer) => {
            stderrTail.push(...chunk.toString().split('\n').map((line) => line.slice(-1000)));
            if (stderrTail.length > 20) stderrTail.splice(0, stderrTail.length - 20);
        });
        child.once('error', (error) => { failure = error; });
        this.childExit = new Promise((resolve) => child.once('close', (code, exitSignal) => {
            if (this.child === child) {
                this.child = null; this.endpoint = null; this.loadedPath = null;
                this.logger.error('local runtime exited unexpectedly', { code, exitSignal, stderrTail });
            }
            failure = failure ?? new Error(`本地推理进程退出：${code ?? exitSignal}`);
            resolve();
        }));
        this.logger.info('local runtime started', { pid: child.pid, model: model.id });
        const loadingSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
        try {
            for (;;) {
                loadingSignal.throwIfAborted();
                if (failure) throw failure;
                try {
                    const response = await undiciFetch(`${endpoint}/health`, {
                        dispatcher: this.directLoopbackAgent,
                        signal: AbortSignal.any([loadingSignal, AbortSignal.timeout(1000)]),
                        headers: { Authorization: `Bearer ${this.apiKey}` },
                    });
                    if (!response.ok) {
                        await response.body?.cancel();
                        throw Object.assign(new Error(`本地推理健康检查 HTTP ${response.status}`), { status: response.status });
                    }
                    const payload = (await response.json()) as { status?: unknown };
                    if (payload?.status !== 'ok') throw new Error('本地推理健康检查响应无效');
                    this.endpoint = endpoint; this.loadedPath = modelPath;
                    return endpoint;
                } catch (error) {
                    if (!LlamaServerProcess.isRuntimeWarmingUp(error, loadingSignal)) throw error;
                }
                await delay(250, undefined, { signal: loadingSignal });
            }
        } catch (error) {
            this.logger.error('local runtime load failed', { error, stderrTail });
            await this.stop();
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    /** 发送一次 chat 请求并返回原始响应体；鉴权、直连回环与超时在此统一处理。 */
    public async postChat(endpoint: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
        const response = await undiciFetch(`${endpoint}/v1/chat/completions`, {
            method: 'POST',
            dispatcher: this.directLoopbackAgent,
            signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            throw new Error(`本地推理请求失败（HTTP ${response.status}）${errBody ? `：${errBody.slice(0, 300)}` : ''}`);
        }
        return response.json();
    }

    /** 结束私有子进程并等待文件句柄释放；超时强制终止。 */
    public async stop(): Promise<void> {
        const child = this.child;
        const exited = this.childExit;
        this.child = null; this.endpoint = null; this.loadedPath = null;
        if (!child) return;
        child.kill();
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        try { await exited; } finally { clearTimeout(timer); }
        this.logger.info('local runtime stopped', { pid: child.pid });
    }

    /** 应用退出时结束子进程并释放回环连接池。 */
    public async dispose(): Promise<void> {
        await this.stop();
        await this.directLoopbackAgent.close().catch(() => undefined);
    }
}
