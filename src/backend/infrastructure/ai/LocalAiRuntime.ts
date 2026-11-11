import { inject, injectable } from 'inversify';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import TYPES from '@/backend/ioc/types';
import type LocalAiService from '@/backend/services/LocalAiService';
import type { LocalGenerateTextOptions } from '@/backend/services/LocalAiService';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { getRuntimeResourcePath } from '@/backend/utils/runtimeEnv';
import { probeReachableDownloadUrl } from '@/backend/utils/probeDownloadUrl';
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

/** 本地生成的 completion token 上限；与采样参数一同约束输出规模。 */
const MAX_COMPLETION_TOKENS = 2048;

/**
 * 完整性标记文件后缀。
 *
 * 校验通过的模型文件旁会留下 `<模型文件>.sha256.ok`，记录这次校验的
 * 模型 id、SHA256 摘要以及当时的文件大小与修改时间。
 */
export const LOCAL_AI_INTEGRITY_MARKER_SUFFIX = '.sha256.ok';

/**
 * 模型完整性标记文件的内容：把一次成功的 SHA256 校验结果记忆下来。
 */
interface ModelIntegrityMarker {
    /** 模型标识，避免同一个文件被当成其它模型的缓存复用。 */
    modelId: string;
    /** 校验通过的 SHA256 摘要。 */
    sha256: string;
    /** 校验时的文件字节数。 */
    size: number;
    /** 校验时的文件修改时间（毫秒时间戳）。 */
    mtimeMs: number;
}

/**
 * 默认采样温度：通用对话档，与词典讲解等链路的生成特性匹配。
 * 翻译等近确定性任务由调用方通过 LocalGenerateTextOptions.temperature 调低。
 */
const DEFAULT_TEMPERATURE = 0.6;

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
 * 推理串行执行；完整校验后原子安装；本地引擎启用时后台预加载并常驻内存，
 * 未启用时空闲五分钟释放模型；同一时间只允许一个模型下载任务，
 * 删除前必须先释放推理进程。
 */
@injectable()
export class LocalAiRuntime implements LocalAiService {
    private readonly logger = getMainLogger('LocalAiRuntime');
    private child: ChildProcess | null = null;
    private childExit: Promise<void> | null = null;
    private endpoint: string | null = null;
    private loadedPath: string | null = null;
    private startInFlight: { modelPath: string; promise: Promise<string> } | null = null;
    private readonly apiKey = randomBytes(32).toString('hex');
    private activeDownload: { modelId: string; task: Promise<void>; abort: AbortController } | null = null;
    private readonly lifetime = new AbortController();
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private busy = 0;
    private phase: LocalAiStatus['models'][number]['phase'] = 'idle';
    private downloaded = 0;
    /** 仅用于连接本机回环 `127.0.0.1` 推理端口的直连客户端，绕过全局代理。 */
    private readonly directLoopbackAgent = new Agent();
    /** 每个模型最近一次下载失败原因；成功后清除，切页后仍可查看。 */
    private readonly modelErrors = new Map<string, string>();
    private lastProgressAt = 0;

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
    ) {}

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
        const bytes = await this.fileSize(filePath);
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

    /** 字幕翻译或词典任一引擎配置为本地模型即视为引擎启用；读设置即时生效，无需事件通知。 */
    private isLocalEngineEnabled(): boolean {
        return this.settingsStore.get('providers.subtitleTranslation') === 'local'
            || this.settingsStore.get('providers.dictionary') === 'local';
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
    private async runtimeReady(): Promise<boolean> {
        return await this.fileSize(this.runtimePath()) > 0 && await this.runtimeMarkerReady();
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

    /** 推送节流后的下载快照；阶段变化和终态始终立即发出。 */
    private emitProgress(modelId: string, force = false): void {
        const now = Date.now();
        if (!force && now - this.lastProgressAt < 100) return;
        this.lastProgressAt = now;
        const model = requireLocalAiModel(modelId);
        this.rendererGateway.fireAndForget('settings/local-ai-model-download-progress', {
            modelId,
            percent: this.downloaded > 0 ? Math.min(100, this.downloaded / model.bytes * 100) : 0,
            downloaded: this.downloaded,
            total: model.bytes,
            phase: this.phase,
        });
    }

    /** 查询普通文件大小；只有不存在属于正常未安装状态。 */
    private async fileSize(file: string): Promise<number> {
        try {
            const stat = await fs.promises.stat(file);
            if (!stat.isFile()) throw new Error(`模型路径不是文件：${file}`);
            return stat.size;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
            throw error;
        }
    }

    /** 计算文件的 SHA256 摘要；大文件按流读取，避免整块载入内存。 */
    private async sha256(file: string, signal?: AbortSignal): Promise<string> {
        const hash = createHash('sha256');
        const stream = fs.createReadStream(file, signal ? { signal } : {});
        for await (const chunk of stream) hash.update(chunk);
        return hash.digest('hex');
    }

    /**
     * 读取完整性标记文件。
     *
     * @param markerPath 标记文件路径。
     * @returns 合法标记内容；文件缺失或内容损坏时返回 `null`，按“需要重新校验”处理。
     */
    private async readIntegrityMarker(markerPath: string): Promise<ModelIntegrityMarker | null> {
        try {
            const raw = await fs.promises.readFile(markerPath, 'utf-8');
            const parsed = JSON.parse(raw) as Partial<ModelIntegrityMarker>;
            if (typeof parsed?.modelId !== 'string' || typeof parsed.sha256 !== 'string'
                || typeof parsed.size !== 'number' || typeof parsed.mtimeMs !== 'number') {
                return null;
            }
            return parsed as ModelIntegrityMarker;
        } catch {
            // 标记缺失或损坏都按“需要重新校验”处理。
            return null;
        }
    }

    /** 写入完整性标记文件；写入失败只记日志，不影响本次校验结论。 */
    private async writeIntegrityMarker(markerPath: string, marker: ModelIntegrityMarker): Promise<void> {
        try {
            await fs.promises.writeFile(markerPath, JSON.stringify(marker), 'utf-8');
        } catch (error) {
            this.logger.warn('model integrity marker write failed', { markerPath, error });
        }
    }

    /**
     * 为已安装的模型文件补写完整性标记，让下次启动不必重新哈希整个模型。
     *
     * @param model 模型定义。
     * @param modelPath 模型文件路径。
     */
    private async markModelVerified(model: LocalAiModelDefinition, modelPath: string): Promise<void> {
        if (!model.sha256) {
            return;
        }
        try {
            const stat = await fs.promises.stat(modelPath);
            await this.writeIntegrityMarker(`${modelPath}${LOCAL_AI_INTEGRITY_MARKER_SUFFIX}`, {
                modelId: model.id,
                sha256: model.sha256,
                size: stat.size,
                mtimeMs: stat.mtimeMs,
            });
        } catch (error) {
            this.logger.warn('model integrity marker write failed', { model: model.id, error });
        }
    }

    /**
     * 校验已安装模型文件的 SHA256 完整性。
     *
     * 为什么必须有这一步：模型文件有 1.28GB，只比对字节数分不清“完整”与
     * “恰好同尺寸的损坏文件”，损坏文件会被当成已安装模型直接加载进推理进程。
     * 但每次启动都重算一遍 SHA256 又太慢（等于每次启动重读 1.28GB），
     * 所以把校验结果记忆在模型文件旁的标记文件里：标记记录的 size 与 mtimeMs
     * 与当前文件一致、且摘要等于期望摘要时，说明文件自上次校验以来没有被改动，
     * 直接复用结论；否则重新计算摘要。
     *
     * 摘要不符时删除损坏文件并抛出明确错误，避免它继续被当作“已安装”。
     *
     * @param model 模型定义。
     * @param modelPath 模型文件路径。
     * @param signal 可选的取消信号。
     */
    private async verifyModelIntegrity(model: LocalAiModelDefinition, modelPath: string, signal?: AbortSignal): Promise<void> {
        // 自定义模型没有可信摘要（来源由用户自行保证），只能做存在性检查。
        if (!model.sha256) {
            return;
        }
        const markerPath = `${modelPath}${LOCAL_AI_INTEGRITY_MARKER_SUFFIX}`;
        const stat = await fs.promises.stat(modelPath);
        const marker = await this.readIntegrityMarker(markerPath);
        if (marker && marker.modelId === model.id && marker.sha256 === model.sha256
            && marker.size === stat.size && marker.mtimeMs === stat.mtimeMs) {
            // 文件自上次校验以来未变化，复用标记里的结论，不再读取整个模型。
            return;
        }
        const digest = await this.sha256(modelPath, signal);
        if (digest !== model.sha256) {
            // 损坏文件留着只会被反复当成“已安装”，删除并作废标记后由用户重新下载。
            await fs.promises.rm(markerPath, { force: true });
            await fs.promises.rm(modelPath, { force: true });
            throw new Error(`模型「${model.name}」SHA256 校验失败，文件已损坏并被删除，请重新下载`);
        }
        await this.writeIntegrityMarker(markerPath, {
            modelId: model.id,
            sha256: model.sha256,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
        });
    }

    /** 返回完整的安装和下载快照，页面重新进入时可以恢复进度。 */
    public async getStatus(): Promise<LocalAiStatus> {
        const models = await Promise.all(LOCAL_AI_MODELS.map(async (model) => {
            const modelPath = await this.modelPath(model);
            const downloading = this.activeDownload?.modelId === model.id;
            return {
                modelId: model.id,
                name: model.name,
                file: model.file,
                bytes: model.bytes,
                sizeLabel: model.sizeLabel,
                memoryEstimateGb: this.memoryEstimateGb(model.bytes),
                // 就绪状态只做体积判断：完整性需要整文件哈希，成本高且不适合在状态轮询里做，
                // 真正的完整性关卡在安装与加载时的 SHA256 校验。
                ready: await this.fileSize(modelPath) === model.bytes,
                phase: downloading ? this.phase : 'idle',
                downloaded: downloading ? this.downloaded : await this.fileSize(`${modelPath}.part`),
                total: model.bytes,
                modelPath,
                downloadUrls: [...model.urls],
                error: this.modelErrors.get(model.id) ?? null,
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
            runtimeReady: await this.runtimeReady(),
            running: this.child !== null,
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
        const model = await this.resolveModelDefinition(modelId);
        const modelPath = await this.modelPath(model);
        if (await this.fileSize(modelPath) !== model.bytes) {
            throw new Error(`模型未下载完成，无法设为使用中：${model.name}`);
        }
        if (!this.settingsStore.set('models.local.active', model.id)) {
            throw new Error(`保存本地模型选择失败：${model.name}`);
        }
        // 常驻模式下后台切换到新模型；引擎未启用时不做任何加载。
        if (this.isLocalEngineEnabled()) void this.preloadActiveModel();
    }

    /** 启动指定模型的下载并保留唯一任务；错误保存在状态中，切页后仍可查看。 */
    public async download(modelId: string): Promise<void> {
        this.lifetime.signal.throwIfAborted();
        if (isCustomModelId(modelId)) {
            throw new Error('自定义模型由用户手动放置，不支持在线下载');
        }
        const model = requireLocalAiModel(modelId);
        if (this.activeDownload) throw new Error(`「${this.activeDownload.modelId}」正在下载，请等待完成后再下载其他模型`);
        if (this.busy > 0) throw new Error('本地模型正在使用，请稍后下载');
        this.phase = 'downloading';
        this.downloaded = 0;
        this.modelErrors.delete(modelId);
        const abort = new AbortController();
        this.emitProgress(modelId, true);
        const signal = AbortSignal.any([abort.signal, this.lifetime.signal]);
        const task = this.install(model, signal);
        this.activeDownload = { modelId, task, abort };
        try {
            await task;
        } catch (error) {
            if (!signal.aborted) {
                this.modelErrors.set(modelId, error instanceof Error ? error.message : String(error));
                this.logger.error('local model download failed', { model: modelId, error });
            }
            throw error;
        } finally {
            this.phase = 'idle';
            this.activeDownload = null;
            this.emitProgress(modelId, true);
        }
    }

    /**
     * 选定本地模型下载地址：多候选时先并行探测可达性，按声明顺序取第一个可达的
     * （国内镜像在前）；全部不可达时仍按首个地址发起请求，失败原因由真实下载给出
     * 并展示在模型卡上。单候选时直接使用，不探测。
     */
    private async resolveDownloadUrl(model: LocalAiModelDefinition, signal: AbortSignal): Promise<string> {
        if (model.urls.length === 1) return model.urls[0];
        const reachable = await probeReachableDownloadUrl([...model.urls], signal);
        this.logger.info('local model download url selected', { model: model.id, reachable: reachable ?? model.urls[0] });
        return reachable ?? model.urls[0];
    }

    /** 下载固定版本，验证长度和 SHA256 后再原子重命名；损坏数据显式报错。 */
    protected async install(model: LocalAiModelDefinition, signal: AbortSignal): Promise<void> {
        const modelPath = await this.modelPath(model);
        if (await this.fileSize(modelPath) === model.bytes) {
            // 已安装的文件不能只看体积：同尺寸的损坏文件会被当成已安装模型继续使用。
            // 这里补一次 SHA256 校验；校验结论由标记文件记忆，重复安装不会反复读整个模型。
            await this.verifyModelIntegrity(model, modelPath, signal);
            return;
        }
        const partial = `${modelPath}.part`;
        await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
        const existing = await this.fileSize(partial);
        if (existing > model.bytes) throw new Error('未完成模型文件大小异常，请删除模型后重新下载');
        this.downloaded = existing;
        this.logger.info('local model download started', { model: model.id, downloaded: existing });
        if (existing < model.bytes) {
            // 多候选地址时先探测可达性择优（官方优先）；既有 .part 跨源续传安全：
            // 镜像与官方是同一文件的逐字节镜像，续传范围校验 + 下载后 SHA256 兜底。
            const downloadUrl = await this.resolveDownloadUrl(model, signal);
            const response = await fetch(downloadUrl, {
                signal,
                headers: existing > 0 ? { Range: `bytes=${existing}-` } : {},
            });
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error(`模型下载请求失败（HTTP ${response.status} ${response.statusText}）`);
            }
            const resumed = response.status === 206;
            if (resumed && response.headers.get('content-range') !== `bytes ${existing}-${model.bytes - 1}/${model.bytes}`) {
                await response.body?.cancel();
                throw new Error('模型下载服务器返回了错误的续传范围');
            }
            if (!response.body) {
                throw new Error(`模型下载响应体为空：${downloadUrl}`);
            }
            if (!resumed) this.downloaded = 0;
            const bodyStream = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>);
            bodyStream.on('data', (chunk: Buffer) => {
                this.downloaded += chunk.length;
                this.emitProgress(model.id);
            });
            await pipeline(bodyStream, fs.createWriteStream(partial, { flags: resumed ? 'a' : 'w' }), { signal });
        }
        if (await this.fileSize(partial) !== model.bytes) throw new Error('模型下载不完整，请继续下载');
        this.phase = 'verifying';
        this.emitProgress(model.id, true);
        const digest = await this.sha256(partial, signal);
        if (digest !== model.sha256) throw new Error('模型 SHA256 校验失败，请删除模型后重新下载');
        signal.throwIfAborted();
        await fs.promises.rename(partial, modelPath);
        // 记录本次已通过的校验，下次启动不必重新哈希整个模型。
        await this.markModelVerified(model, modelPath);
        this.logger.info('local model installed', { model: model.id });
    }

    /** 等待取消完成后再允许重试，避免多个写入器同时操作续传文件。 */
    public async cancelDownload(): Promise<void> {
        const task = this.activeDownload?.task;
        if (!task) return;
        this.activeDownload?.abort.abort();
        await task.catch((error) => {
            if (!(error instanceof Error) || (error.name !== 'AbortError' && error.name !== 'CanceledError')) {
                throw error;
            }
        });
    }

    /** 删除指定模型的安装文件及续传数据；先释放已加载的模型。 */
    public async deleteModel(modelId: string): Promise<void> {
        const model = await this.resolveModelDefinition(modelId);
        if (this.activeDownload?.modelId === modelId) throw new Error('模型正在下载，请先取消下载');
        // busy 计数必须在任何 await 之前递增，否则推理请求可能落在检查与递增之间。
        if (this.busy > 0) throw new Error('本地模型正在使用，请稍后删除');
        this.busy++;
        try {
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
            this.modelErrors.delete(modelId);
            this.downloaded = 0;
        } finally { this.busy--; }
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

    /** 按需加载模型，使用随机鉴权密钥并等待就绪；并发冷启动共享同一启动流程，加载失败会结束子进程。 */
    private async start(model: LocalAiModelDefinition, signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        const modelPath = await this.modelPath(model);
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

        const promise = this.doStart(model, modelPath, this.lifetime.signal)
            .finally(() => {
                if (this.startInFlight?.promise === promise) {
                    this.startInFlight = null;
                }
            });
        this.startInFlight = { modelPath, promise };
        return await this.awaitWithCallerSignal(promise, signal);
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

    /** 实际执行模型完整性校验与 llama-server 进程拉起。 */
    private async doStart(model: LocalAiModelDefinition, modelPath: string, signal: AbortSignal): Promise<string> {
        await this.stop();
        if (await this.fileSize(modelPath) !== model.bytes) {
            throw new Error(`本地模型「${model.name}」未安装，请前往设置-服务凭据下载`);
        }
        // 加载前必须通过完整性校验：同尺寸的损坏文件不得进入推理进程。
        await this.verifyModelIntegrity(model, modelPath, signal);
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
                    if (!LocalAiRuntime.isRuntimeWarmingUp(error, loadingSignal)) throw error;
                }
                await delay(250, undefined, { signal: loadingSignal });
            }
        } catch (error) {
            this.logger.error('local runtime load failed', { error, stderrTail });
            await this.stop();
            throw error instanceof Error ? error : new Error(String(error));
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
        if (this.activeDownload?.modelId === modelId) throw new Error(`本地模型「${model.name}」正在安装`);
        const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(300_000), ...(signal ? [signal] : [])]);
        return this.runSerial(async () => {
            const endpoint = await this.start(model, combined);
            const startedAt = Date.now();
            try {
                const result = responseSchema.parse(await this.postChat(endpoint, this.buildChatBody(model.id, prompt, schema, options), combined));
                const finishReason = result.choices[0].finish_reason;
                if (finishReason !== 'stop') {
                    // length：输出顶到 max_tokens 上限被截断，输出必然不完整；
                    // 其余原因原样透出，避免 zod 天书直接冒给用户。
                    throw new Error(finishReason === 'length'
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
                const isSemanticError = error instanceof Error && (
                    error.message.includes('token 上限被截断')
                    || error.message.includes('finish_reason=')
                );
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
        if (this.activeDownload) throw new Error('本地模型正在下载，请等待完成后再测速');
        // 占用计数在任何 await 之前递增，避免与推理/删除请求落在检查与递增之间。
        if (this.busy > 0) throw new Error('本地模型正在使用，请稍后重试');
        this.busy++;
        try {
            const model = await this.resolveModelDefinition(modelId);
            const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(300_000)]);
            this.clearIdleTimer();
            return await concurrency.withSemaphore('localAi', async () => {
                const endpoint = await this.start(model, combined);
                const schema = z.object({ items: z.array(z.object({ key: z.string(), translation: z.string() })) });
                const body = this.buildChatBody(model.id, LocalAiRuntime.SPEED_TEST_PROMPT, z.toJSONSchema(schema));
                try {
                    // 首轮仅作热身（可能含推理初始化开销），不写入结果。
                    const firstStartedAt = Date.now();
                    const first = await this.postChat(endpoint, body, combined);
                    const firstMs = Date.now() - firstStartedAt;
                    const warmStartedAt = Date.now();
                    const warm = await this.postChat(endpoint, body, combined);
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
        if (this.idleTimer || this.busy > 0 || !this.child || this.lifetime.signal.aborted) return;
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
            const model = await this.resolveModelDefinition(await this.getActiveModelId());
            if (this.child && this.loadedPath === await this.modelPath(model)) return;
            await this.runSerial(async () => {
                await this.start(model, this.lifetime.signal);
            }, this.lifetime.signal);
            this.logger.info('local model preloaded', { model: model.id });
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

    /** 组装与推理参数固定一致的 chat 请求体；本地链路所有生成共用同一采样参数，温度可被 options.temperature 覆盖。schema 与 grammar 互斥使用：schema 走 json_object，grammar 走 llama.cpp 顶层 GBNF 约束。 */
    private buildChatBody(modelId: string, prompt: string, schema: Record<string, unknown> | null, options?: LocalGenerateTextOptions): Record<string, unknown> {
        return {
            model: modelId,
            messages: [{ role: 'user', content: prompt }],
            stream: false, temperature: options?.temperature ?? DEFAULT_TEMPERATURE, top_p: 0.95, top_k: 20,
            max_tokens: MAX_COMPLETION_TOKENS,
            ...(schema ? { response_format: { type: 'json_object', schema } } : {}),
            ...(options?.grammar ? { grammar: options.grammar } : {}),
            chat_template_kwargs: { enable_thinking: false },
        };
    }

    /** 发送一次 chat 请求并返回原始响应体；鉴权、直连回环与超时在此统一处理。 */
    private async postChat(endpoint: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
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
    private async stop(): Promise<void> {
        this.clearIdleTimer();
        const child = this.child;
        const exited = this.childExit;
        this.child = null; this.endpoint = null; this.loadedPath = null;
        if (!child) return;
        child.kill();
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        try { await exited; } finally { clearTimeout(timer); }
        this.logger.info('local runtime stopped', { pid: child.pid });
    }

    /** 应用退出时取消全部工作并等待模型文件、子进程与连接池释放。 */
    public async shutdown(): Promise<void> {
        this.lifetime.abort();
        await this.cancelDownload();
        await this.stop();
        await this.directLoopbackAgent.close().catch(() => undefined);
    }
}
