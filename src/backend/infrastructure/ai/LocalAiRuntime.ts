import { inject, injectable } from 'inversify';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import TYPES from '@/backend/ioc/types';
import type LocalAiService from '@/backend/services/LocalAiService';
import type { LocalChatMessage, LocalGenerateTextOptions } from '@/backend/services/LocalAiService';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { concurrency } from '@/backend/utils/concurrency';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import {
    CUSTOM_MODEL_ID_PREFIX,
    isCustomModelId,
    LOCAL_AI_DEFAULT_MODEL_ID,
    LOCAL_AI_MODELS,
    type LocalAiModelDefinition,
    type LocalAiSpeedTestResult,
    type LocalAiStatus,
    requireLocalAiModel,
} from '@/common/contracts/local-ai';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import { LocalModelInstaller, LOCAL_AI_INTEGRITY_MARKER_SUFFIX } from './LocalModelInstaller';
import { LlamaServerProcess } from './LlamaServerProcess';

export { LOCAL_AI_INTEGRITY_MARKER_SUFFIX };

/** 本地生成的 completion token 上限；与采样参数一同约束输出规模。 */
const MAX_COMPLETION_TOKENS = 2048;

/**
 * 模型输出语义异常（截断或未正常结束）。
 *
 * 这类错误说明请求本身是通的，只是这次输出不可用；调用方不应据此重启共享进程。
 * 用类型而不是错误文案来判断，避免以后改提示语时静默失效。
 */
class LocalAiSemanticError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LocalAiSemanticError';
    }
}

/**
 * 默认采样温度：通用对话档，与词典讲解等链路的生成特性匹配。
 * 翻译等近确定性任务由调用方通过 LocalGenerateTextOptions.temperature 调低。
 */
const DEFAULT_TEMPERATURE = 0.6;

const responseSchema = z.object({
    choices: z.array(z.object({
        finish_reason: z.string(),
        message: z.object({ content: z.string() }),
    })).length(1),
    usage: z.object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
    }).optional(),
});

/** 速度测试响应中 token 用量的宽松解析；推理端未返回用量时为 undefined。 */
const speedUsageSchema = z.object({
    usage: z.object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
    }).optional(),
});

/**
 * 管理目录内多个 GGUF 模型和应用私有的 llama-server 子进程。
 *
 * 本类只保留编排与生命周期决策（忙时计数、空闲卸载、常驻预加载、状态快照）；
 * 模型文件的下载与完整性校验在 {@link LocalModelInstaller}，子进程与回环 HTTP
 * 的生命周期在 {@link LlamaServerProcess}。推理串行执行；完整校验后原子安装；
 * 本地引擎启用时后台预加载并常驻内存，未启用时空闲五分钟释放模型；
 * 同一时间只允许一个模型下载任务，删除前必须先释放推理进程。
 */
@injectable()
export class LocalAiRuntime implements LocalAiService {
    private readonly logger = getMainLogger('LocalAiRuntime');
    private readonly lifetime = new AbortController();
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private busy = 0;
    /** 模型文件的下载与完整性校验；下载状态与失败记录由它独占。 */
    private readonly installer: LocalModelInstaller;
    /** 应用私有的 llama-server 子进程与回环 HTTP；进程状态由它独占。 */
    private readonly serverProcess: LlamaServerProcess;

    /** 速度测试固定负载：5 句字幕批量翻译，与真实字幕批次同量级。 */
    private static readonly SPEED_TEST_PROMPT = [
        'Translate each subtitle line into Simplified Chinese.',
        'Respond with JSON only: {"items":[{"key":"<given key>","translation":"<simplified chinese>"}]}',
        '',
        '1: The weather turned colder as the sun went down.',
        '2: She packed the last box and looked around the empty apartment.',
        '3: The train arrives at platform nine in ten minutes.',
        '4: He promised to call as soon as the meeting ended.',
        '5: Nobody expected the storm to arrive so early in the season.',
    ].join('\n');

    /** 注入模型目录、设置存储和 renderer 通知边界。 */
    public constructor(
        @inject(TYPES.StorageDirectoryProvider) private readonly directories: StorageDirectoryProvider,
        @inject(TYPES.RendererGateway) private readonly rendererGateway: RendererGateway,
        @inject(TYPES.SettingsStore) private readonly settingsStore: SettingsStore,
    ) {
        this.installer = new LocalModelInstaller({
            rendererGateway: this.rendererGateway,
            resolveModelPath: (model) => this.modelPath(model),
        });
        this.serverProcess = new LlamaServerProcess({
            lifetimeSignal: this.lifetime.signal,
            resolveModelPath: (model) => this.modelPath(model),
            fileSize: (file) => this.installer.fileSize(file),
            verifyIntegrity: (model, modelPath, signal) => this.installer.verifyModelIntegrity(model, modelPath, signal),
        });
    }

    /** 解析模型在媒体库中的安装路径；目录模型在独立子目录，自定义模型直接位于模型根目录。 */
    private async modelPath(model: LocalAiModelDefinition): Promise<string> {
        const directory = await this.modelsDirectory();
        return model.source === 'custom'
            ? path.join(directory, model.file)
            : path.join(directory, model.id, model.file);
    }

    /** 返回模型根目录的绝对路径，供设置页展示手动安装教程。 */
    private async modelsDirectory(): Promise<string> {
        return this.directories.provideDirectory(StorageDirectoryTarget.MODELS);
    }

    /** 估算模型运行内存占用；约为文件体积的 1.5 倍，覆盖权重 + KV cache + 推理缓冲。 */
    private memoryEstimateGb(bytes: number): string {
        return (bytes * 1.5 / 1024 / 1024 / 1024).toFixed(1);
    }

    /**
     * 将用户手动放入模型根目录的 GGUF 文件解析为自定义模型定义。
     *
     * 自定义 id 形如 `custom:<文件名>`；文件必须真实存在且非空，
     * 字节数以磁盘实际大小为准（无法做 SHA256 校验，由用户自行保证来源可靠）。
     */
    private async resolveCustomModel(modelId: string): Promise<LocalAiModelDefinition> {
        const file = modelId.slice(CUSTOM_MODEL_ID_PREFIX.length);
        if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) {
            throw new Error(`非法的自定义模型标识：${modelId}`);
        }
        const directory = await this.modelsDirectory();
        const filePath = path.join(directory, file);
        const bytes = await this.installer.fileSize(filePath);
        if (bytes <= 0) {
            throw new Error(`自定义模型文件不存在：${filePath}`);
        }
        return {
            id: modelId,
            name: file,
            file,
            bytes,
            sizeLabel: `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
            urls: [],
            sha256: '',
            source: 'custom',
        };
    }

    /**
     * 解析任意模型 id 为完整定义；先查目录，再查自定义文件，都不存在时显式报错。
     */
    private async resolveModelDefinition(modelId: string): Promise<LocalAiModelDefinition> {
        if (isCustomModelId(modelId)) {
            return this.resolveCustomModel(modelId);
        }
        return requireLocalAiModel(modelId);
    }

    /** 扫描模型根目录下用户手动放入的 GGUF 文件（跳过隐藏文件与目录模型子目录）。 */
    private async scanCustomModels(): Promise<LocalAiModelDefinition[]> {
        const directory = await this.modelsDirectory();
        let entries: string[];
        try {
            entries = await fs.promises.readdir(directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
        const models = await Promise.all(entries
            .filter((entry) => entry.toLowerCase().endsWith('.gguf') && !entry.startsWith('.'))
            .map((file) => this.resolveCustomModel(`${CUSTOM_MODEL_ID_PREFIX}${file}`).catch(() => null)));
        return models.filter((model): model is LocalAiModelDefinition => model !== null);
    }

    /** 字幕翻译或词典任一引擎配置为本地模型即视为引擎启用；读设置即时生效，无需事件通知。 */
    private isLocalEngineEnabled(): boolean {
        return this.settingsStore.get('providers.subtitleTranslation') === 'local'
            || this.settingsStore.get('providers.dictionary') === 'local';
    }

    /** 返回完整的安装和下载快照，页面重新进入时可以恢复进度。 */
    public async getStatus(): Promise<LocalAiStatus> {
        const download = this.installer.downloadSnapshot();
        const models = await Promise.all(LOCAL_AI_MODELS.map(async (model) => {
            const modelPath = await this.modelPath(model);
            const downloading = download.modelId === model.id;
            return {
                modelId: model.id,
                name: model.name,
                file: model.file,
                bytes: model.bytes,
                sizeLabel: model.sizeLabel,
                memoryEstimateGb: this.memoryEstimateGb(model.bytes),
                // 就绪状态只做体积判断：完整性需要整文件哈希，成本高且不适合在状态轮询里做，
                // 真正的完整性关卡在安装与加载时的 SHA256 校验。
                ready: await this.installer.fileSize(modelPath) === model.bytes,
                phase: downloading ? download.phase : 'idle',
                downloaded: downloading ? download.downloadedBytes : await this.installer.fileSize(`${modelPath}.part`),
                total: model.bytes,
                modelPath,
                downloadUrls: [...model.urls],
                error: this.installer.errorFor(model.id),
                custom: false,
            };
        }));
        const customModels = await Promise.all((await this.scanCustomModels()).map(async (model) => ({
            modelId: model.id,
            name: model.name,
            file: model.file,
            bytes: model.bytes,
            sizeLabel: model.sizeLabel,
            memoryEstimateGb: this.memoryEstimateGb(model.bytes),
            ready: true,
            phase: 'idle' as const,
            downloaded: model.bytes,
            total: model.bytes,
            modelPath: await this.modelPath(model),
            downloadUrls: [],
            error: null,
            custom: true,
        })));
        return {
            runtimeReady: await this.serverProcess.runtimeReady(),
            running: this.serverProcess.isRunning(),
            activeModelId: await this.getActiveModelId(),
            modelsDirectory: await this.modelsDirectory(),
            models: [...models, ...customModels],
        };
    }

    public async getActiveModelId(): Promise<string> {
        const modelId = this.settingsStore.get('models.local.active');
        if (isCustomModelId(modelId)) {
            // 自定义模型文件被手动删除时显式报错，让用户重新选择，不做静默回退。
            await this.resolveCustomModel(modelId);
            return modelId;
        }
        if (LOCAL_AI_MODELS.some((model) => model.id === modelId)) {
            return modelId;
        }
        // 模型目录随版本演进可能移除旧条目；存储的使用中 id 失效时显式迁移到新默认值。
        // 这是一次性目录迁移，不是运行时兑底：只针对“id 已不在当前目录”这一种状态。
        this.logger.warn('stored local model id is no longer in catalog, reset to default', {
            stored: modelId,
            default: LOCAL_AI_DEFAULT_MODEL_ID,
        });
        if (!this.settingsStore.set('models.local.active', LOCAL_AI_DEFAULT_MODEL_ID)) {
            throw new Error(`本地模型目录已更新，重置使用中模型失败：${modelId}`);
        }
        return LOCAL_AI_DEFAULT_MODEL_ID;
    }

    public async setActiveModelId(modelId: string): Promise<void> {
        // 切换模型会 stop() 当前进程，在途推理会被直接杀掉；
        // 与删除/测速一致，在首个 await 前同步占坑并在 try/finally 内释放，避免并发校验窗口穿插。
        if (this.busy > 0) throw new Error('本地模型正在使用，请稍后切换');
        this.busy++;
        this.clearIdleTimer();
        let shouldPreload = false;
        try {
            const model = await this.resolveModelDefinition(modelId);
            const modelPath = await this.modelPath(model);
            if (await this.installer.fileSize(modelPath) !== model.bytes) {
                throw new Error(`模型未下载完成，无法设为使用中：${model.name}`);
            }
            if (!this.settingsStore.set('models.local.active', model.id)) {
                throw new Error(`保存本地模型选择失败：${model.name}`);
            }
            shouldPreload = this.isLocalEngineEnabled();
        } finally {
            this.busy--;
            this.settleBusy();
        }
        // 常驻模式下后台切换到新模型；引擎未启用时不做任何加载。
        if (shouldPreload) void this.preloadActiveModel();
    }

    /** 启动指定模型的下载；下载状态机与互斥检查在 LocalModelInstaller，忙时拒绝在编排层。 */
    public async download(modelId: string): Promise<void> {
        this.lifetime.signal.throwIfAborted();
        if (isCustomModelId(modelId)) {
            throw new Error('自定义模型由用户手动放置，不支持在线下载');
        }
        const model = requireLocalAiModel(modelId);
        if (this.busy > 0) throw new Error('本地模型正在使用，请稍后下载');
        await this.installer.download(model, this.lifetime.signal);
    }

    /** 等待取消完成后再允许重试，避免多个写入器同时操作续传文件。 */
    public async cancelDownload(): Promise<void> {
        await this.installer.cancelDownload();
    }

    /**
     * 测试缝：暴露安装链路供子类直测（下载选源、断点续传与完整性校验）；
     * 实现整体在 {@link LocalModelInstaller}。
     */
    protected async install(model: LocalAiModelDefinition, signal: AbortSignal): Promise<void> {
        return this.installer.install(model, signal);
    }

    /** 删除指定模型的安装文件及续传数据；先释放已加载的模型。 */
    public async deleteModel(modelId: string): Promise<void> {
        if (this.installer.downloadingModelId === modelId) throw new Error('模型正在下载，请先取消下载');
        // busy 计数必须在任何 await（含 resolveModelDefinition）之前同步递增，否则切换/推理可能落在检查与递增之间。
        if (this.busy > 0) throw new Error('本地模型正在使用，请稍后删除');
        this.busy++;
        this.clearIdleTimer();
        try {
            const model = await this.resolveModelDefinition(modelId);
            if (this.installer.downloadingModelId === modelId) throw new Error('模型正在下载，请先取消下载');
            if (modelId === await this.getActiveModelId()) {
                throw new Error(`「${model.name}」是使用中的本地模型，请先在服务凭据页切换到其他模型`);
            }
            await this.stop();
            const modelPath = await this.modelPath(model);
            if (model.source === 'catalog') {
                // 目录模型的安装产物在独立子目录（GGUF、续传文件与可能的聊天模板），整目录删除。
                await fs.promises.rm(path.dirname(modelPath), { force: true, recursive: true });
            } else {
                await fs.promises.rm(modelPath, { force: true });
                await fs.promises.rm(`${modelPath}.part`, { force: true });
                // 完整性标记与模型文件同目录，自定义模型需单独清理。
                await fs.promises.rm(`${modelPath}${LOCAL_AI_INTEGRITY_MARKER_SUFFIX}`, { force: true });
            }
            this.installer.forgetModel(modelId);
        } finally {
            this.busy--;
            this.settleBusy();
        }
    }

    /**
     * 串行生成，限制上下文和输出长度；仅接受完整结束且可解析的 JSON。
     */
    public async generate(prompt: string, schema: Record<string, unknown>, modelId: string, signal?: AbortSignal): Promise<unknown> {
        const parsed = await this.completeText(prompt, schema, modelId, signal);
        let result: unknown;
        try {
            result = JSON.parse(parsed.content);
        } catch (error) {
            throw new Error(`本地模型返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`);
        }
        return result;
    }

    /** 纯文本生成：与 generate 共用生命周期，仅不约束 JSON 输出；传入 options.grammar 时在解码层约束输出形状，options.temperature 覆盖采样温度。 */
    public async generateText(
        prompt: string,
        modelId: string,
        signal?: AbortSignal,
        options?: LocalGenerateTextOptions,
    ): Promise<string> {
        return (await this.completeText(prompt, null, modelId, signal, options)).content;
    }

    /**
     * 流式生成文本或受 Schema 约束的 JSON：消费 llama-server SSE delta 并实时回调，
     * 返回拼接后的完整输出，保留并发 slot 隔离保护。
     */
    public async streamText(
        input: string | LocalChatMessage[],
        modelId: string,
        callbacks: { onDelta: (delta: string) => void },
        signal?: AbortSignal,
        options?: LocalGenerateTextOptions,
    ): Promise<string> {
        const model = await this.resolveModelDefinition(modelId);
        if (this.installer.downloadingModelId === modelId) throw new Error(`本地模型「${model.name}」正在安装`);
        const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(300_000), ...(signal ? [signal] : [])]);
        const messages = this.normalizeLocalMessages(input);
        const schema = options?.schema ?? null;

        return this.runSerial(async () => {
            const endpoint = await this.serverProcess.start(model, combined);
            const startedAt = Date.now();
            let accumulated = '';
            let finishReason: string | null = null;
            let usage: { prompt_tokens: number; completion_tokens: number } | undefined;

            try {
                const body = this.buildChatBody(model.id, messages, schema, options, true);
                for await (const event of this.serverProcess.postChatStream(endpoint, body, combined)) {
                    if (event.type === 'delta') {
                        accumulated += event.text;
                        callbacks.onDelta(event.text);
                    } else {
                        finishReason = event.finishReason;
                        usage = event.usage;
                    }
                }
                if (finishReason && finishReason !== 'stop') {
                    throw new LocalAiSemanticError(finishReason === 'length'
                        ? `本地模型输出超过单次 ${MAX_COMPLETION_TOKENS} token 上限被截断（多为模型输出循环），请重试`
                        : `本地模型输出未正常结束（finish_reason=${finishReason}）`);
                }
                const durationMs = Date.now() - startedAt;
                this.logger.info('local stream completed', {
                    model: model.id,
                    durationMs,
                    responseLength: accumulated.length,
                    usage: usage ? {
                        prompt: usage.prompt_tokens,
                        completion: usage.completion_tokens,
                        perSecond: Number((usage.completion_tokens / Math.max(durationMs / 1000, 0.001)).toFixed(1)),
                    } : null,
                });
                return accumulated;
            } catch (error) {
                const callerAborted = Boolean(signal?.aborted) && !this.lifetime.signal.aborted;
                const isSemanticError = error instanceof LocalAiSemanticError;
                this.logger.error('local stream failed', { error, model: model.id, durationMs: Date.now() - startedAt });
                const hasSiblingRequests = this.busy > 1;
                if (!callerAborted && !isSemanticError && !hasSiblingRequests) {
                    await this.stop();
                }
                throw error;
            }
        }, combined);
    }

    /**
     * 串行生成一轮完整回复；schema 与 grammar 二选一，都为 null 时不约束输出格式。
     * finish_reason 非 stop（截断/异常终止）时显式报错。
     */
    private async completeText(
        prompt: string,
        schema: Record<string, unknown> | null,
        modelId: string,
        signal?: AbortSignal,
        options?: LocalGenerateTextOptions,
    ): Promise<{ content: string, usage: { prompt: number, completion: number } | null }> {
        const model = await this.resolveModelDefinition(modelId);
        if (this.installer.downloadingModelId === modelId) throw new Error(`本地模型「${model.name}」正在安装`);
        const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(300_000), ...(signal ? [signal] : [])]);
        return this.runSerial(async () => {
            const endpoint = await this.serverProcess.start(model, combined);
            const startedAt = Date.now();
            try {
                const result = responseSchema.parse(await this.serverProcess.postChat(endpoint, this.buildChatBody(model.id, prompt, schema, options), combined));
                const finishReason = result.choices[0].finish_reason;
                if (finishReason !== 'stop') {
                    // length：输出顶到 max_tokens 上限被截断，输出必然不完整；
                    // 其余原因原样透出，避免 zod 天书直接冒给用户。
                    throw new LocalAiSemanticError(finishReason === 'length'
                        ? `本地模型输出超过单次 ${MAX_COMPLETION_TOKENS} token 上限被截断（多为模型输出循环），请重试`
                        : `本地模型输出未正常结束（finish_reason=${finishReason}）`);
                }
                const durationMs = Date.now() - startedAt;
                this.logger.info('local generation completed', {
                    model: model.id,
                    durationMs,
                    // 键名避开 "token" 子串：日志脱敏规则会把含 token 的键整体打码。
                    usage: result.usage ? {
                        prompt: result.usage.prompt_tokens,
                        completion: result.usage.completion_tokens,
                        perSecond: Number((result.usage.completion_tokens / (durationMs / 1000)).toFixed(1)),
                    } : null,
                });
                return {
                    content: result.choices[0].message.content,
                    usage: result.usage
                        ? { prompt: result.usage.prompt_tokens, completion: result.usage.completion_tokens }
                        : null,
                };
            } catch (error) {
                const callerAborted = Boolean(signal?.aborted) && !this.lifetime.signal.aborted;
                const isSemanticError = error instanceof LocalAiSemanticError;
                this.logger.error('local generation failed', { error, model: model.id, durationMs: Date.now() - startedAt });
                // 单个调用方取消（如滚动窗口切换）或单槽位输出触顶时，不能杀掉共享的 llama-server 进程，
                // 否则会导致其余 3 个并行推理槽位连坐 ECONNRESET。
                //
                // busy > 1 同理：还有别的请求正在同一个子进程上解码。一次 HTTP 5xx 或一次 zod 校验失败
                // 只说明「这一个请求」出问题，杀掉进程会让健康请求一起失败、整批字幕重试。
                // 进程是否真的坏了交给下一次 start()/健康检查判断，不在这里连坐。
                const hasSiblingRequests = this.busy > 1;
                if (!callerAborted && !isSemanticError && !hasSiblingRequests) {
                    await this.stop();
                }
                throw error;
            }
        }, combined);
    }

    /**
     * 对指定模型执行稳态速度测试：两轮固定批量生成，取热身轮吞吐。
     *
     * 不主动释放已加载模型——常驻模式下直接复用当前进程，模型未加载时由
     * start() 按需加载。负载为 5 句字幕翻译，与真实字幕批次同量级；
     * 采样参数与 generate 完全一致，测得的速度即真实翻译速度。
     *
     * @param modelId 待测速的本地模型标识。
     * @returns 热身轮耗时与 token 用量、生成速度。
     */
    public async speedTest(modelId: string): Promise<LocalAiSpeedTestResult> {
        if (this.installer.downloadingModelId) throw new Error('本地模型正在下载，请等待完成后再测速');
        // 占用计数在任何 await 之前递增，避免与推理/删除请求落在检查与递增之间。
        if (this.busy > 0) throw new Error('本地模型正在使用，请稍后重试');
        this.busy++;
        try {
            const model = await this.resolveModelDefinition(modelId);
            const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(300_000)]);
            this.clearIdleTimer();
            return await concurrency.withSemaphore('localAi', async () => {
                const endpoint = await this.serverProcess.start(model, combined);
                const schema = z.object({ items: z.array(z.object({ key: z.string(), translation: z.string() })) });
                const body = this.buildChatBody(model.id, LocalAiRuntime.SPEED_TEST_PROMPT, z.toJSONSchema(schema));
                try {
                    // 首轮仅作热身（可能含推理初始化开销），不写入结果。
                    const firstStartedAt = Date.now();
                    const first = await this.serverProcess.postChat(endpoint, body, combined);
                    const firstMs = Date.now() - firstStartedAt;
                    const warmStartedAt = Date.now();
                    const warm = await this.serverProcess.postChat(endpoint, body, combined);
                    const warmMs = Date.now() - warmStartedAt;
                    const firstUsage = speedUsageSchema.parse(first).usage;
                    const warmUsage = speedUsageSchema.parse(warm).usage;
                    const result: LocalAiSpeedTestResult = {
                        warmMs,
                        promptTokens: warmUsage?.prompt_tokens ?? null,
                        completionTokens: warmUsage?.completion_tokens ?? null,
                        tokensPerSecond: warmUsage ? Number((warmUsage.completion_tokens / (warmMs / 1000)).toFixed(1)) : null,
                    };
                    // 键名避开 "token" 子串：日志脱敏规则会把含 token 的键整体打码。
                    const usageForLog = (usage: { prompt_tokens: number; completion_tokens: number } | undefined, durationMs: number) => usage
                        ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens, perSecond: Number((usage.completion_tokens / (durationMs / 1000)).toFixed(1)) }
                        : null;
                    this.logger.info('local speed test completed', {
                        model: model.id,
                        warmMs,
                        usage: {
                            first: usageForLog(firstUsage, firstMs),
                            warm: usageForLog(warmUsage, warmMs),
                        },
                    });
                    return result;
                } catch (error) {
                    this.logger.error('local speed test failed', { error, model: model.id });
                    await this.stop();
                    throw error;
                }
            }, { signal: combined });
        } finally {
            this.busy--;
            this.settleBusy();
            // 测的可能不是使用中模型；常驻模式下把使用中模型拉回前台。
            if (this.isLocalEngineEnabled()) void this.preloadActiveModel();
        }
    }

    /** 归零占用计数后的常驻决策：本地引擎启用时模型常驻内存，否则武装空闲卸载。 */
    private settleBusy(): void {
        if (this.busy > 0 || this.lifetime.signal.aborted) return;
        if (this.isLocalEngineEnabled()) return;
        this.armIdleUnload();
    }

    /** 武装空闲卸载计时器（幂等，不重置已有计时器）；没有在跑的进程时无事可做。 */
    private armIdleUnload(): void {
        if (this.idleTimer || this.busy > 0 || !this.serverProcess.isRunning() || this.lifetime.signal.aborted) return;
        this.idleTimer = setTimeout(() => { void this.stop().catch((error) => this.logger.error('local runtime stop failed', { error })); }, 300_000);
        this.idleTimer.unref();
    }

    /** 清除空闲卸载计时器。 */
    private clearIdleTimer(): void {
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    }

    /** 按当前设置同步常驻策略；预加载在后台进行，失败只记日志不阻塞调用方。 */
    public syncEngineResidency(): void {
        this.clearIdleTimer();
        if (!this.isLocalEngineEnabled()) {
            this.armIdleUnload();
            return;
        }
        void this.preloadActiveModel();
    }

    /**
     * 后台预加载使用中的模型；已加载目标模型时直接返回。
     *
     * 借助 localAi 信号量串行执行，与推理请求共享同一互斥边界，避免与在途
     * 请求并发触发两次进程启动；冷加载期间到达的翻译请求自动排队。
     * 模型未安装、运行时缺失等预加载失败只记日志，由首次推理显式报错。
     */
    private async preloadActiveModel(): Promise<void> {
        try {
            this.lifetime.signal.throwIfAborted();
            await this.runSerial(async (signal) => {
                if (!this.isLocalEngineEnabled()) return;
                const model = await this.resolveModelDefinition(await this.getActiveModelId());
                if (this.serverProcess.isLoadedModel(await this.modelPath(model))) return;
                await this.serverProcess.start(model, signal);
                this.logger.info('local model preloaded', { model: model.id });
            }, this.lifetime.signal);
        } catch (error) {
            this.logger.warn('local model preload failed', { error });
        }
    }

    /** 在本地推理互斥信号量内执行；占用期间暂停空闲卸载，结束后重新计时。 */
    private async runSerial<T>(fn: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
        this.busy++;
        this.clearIdleTimer();
        try {
            return await concurrency.withSemaphore('localAi', () => fn(signal), { signal });
        } finally {
            this.busy--;
            this.settleBusy();
        }
    }

    /**
     * 将输入归一化为标准且角色严格交替的 OpenAI messages 数组。
     *
     * Gemma / Qwen 等 Jinja 模板要求可选的 system 后，user / assistant 必须严格交替且首轮为 user；
     * 若历史裁剪后出现连续同角色，自动合并文本，避免模板渲染直接 HTTP 500。
     */
    private normalizeLocalMessages(input: string | LocalChatMessage[]): LocalChatMessage[] {
        if (typeof input === 'string') {
            return [{ role: 'user', content: input }];
        }
        const systemParts: string[] = [];
        const turns: LocalChatMessage[] = [];
        for (const msg of input) {
            const text = msg.content.trim();
            if (!text) continue;
            if (msg.role === 'system') {
                systemParts.push(text);
                continue;
            }
            const last = turns[turns.length - 1];
            if (last && last.role === msg.role) {
                last.content = `${last.content}\n\n${text}`;
            } else {
                turns.push({ role: msg.role, content: text });
            }
        }
        if (turns.length === 0) {
            turns.push({ role: 'user', content: '请开始。' });
        } else if (turns[0].role !== 'user') {
            turns.unshift({ role: 'user', content: '（继续上面讨论）' });
        }
        return systemParts.length > 0
            ? [{ role: 'system', content: systemParts.join('\n\n') }, ...turns]
            : turns;
    }

    /** 组装与推理参数固定一致的 chat 请求体；本地链路所有生成共用同一采样参数，温度可被 options.temperature 覆盖。schema 与 grammar 互斥使用：schema 走 json_object，grammar 走 llama.cpp 顶层 GBNF 约束。 */
    private buildChatBody(
        modelId: string,
        input: string | LocalChatMessage[],
        schema: Record<string, unknown> | null,
        options?: LocalGenerateTextOptions,
        stream = false,
    ): Record<string, unknown> {
        const messages = this.normalizeLocalMessages(input);
        return {
            model: modelId,
            messages,
            stream, temperature: options?.temperature ?? DEFAULT_TEMPERATURE, top_p: 0.95, top_k: 20,
            max_tokens: MAX_COMPLETION_TOKENS,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
            ...(schema ? { response_format: { type: 'json_object', schema } } : {}),
            ...(options?.grammar ? { grammar: options.grammar } : {}),
            chat_template_kwargs: { enable_thinking: false },
        };
    }

    /** 结束子进程并清除空闲卸载计时器；编排层的统一退出出口。 */
    private async stop(): Promise<void> {
        this.clearIdleTimer();
        await this.serverProcess.stop();
    }

    /** 应用退出时取消全部工作并等待模型文件、子进程与连接池释放。 */
    public async shutdown(): Promise<void> {
        this.lifetime.abort();
        await this.cancelDownload();
        await this.serverProcess.dispose();
    }
}
