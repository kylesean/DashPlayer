import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { probeReachableDownloadUrl } from '@/backend/utils/probeDownloadUrl';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { LocalAiModelDefinition, LocalAiStatus } from '@/common/contracts/local-ai';
import { requireLocalAiModel } from '@/common/contracts/local-ai';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';

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
 * 当前下载快照：供状态查询恢复下载进度。
 */
export interface LocalModelDownloadSnapshot {
    /** 当前下载阶段；无下载任务时为 idle。 */
    phase: LocalAiStatus['models'][number]['phase'];
    /** 当前已下载字节数；无下载任务时为 0。 */
    downloadedBytes: number;
    /** 正在下载的模型标识；无下载任务时为 null。 */
    modelId: string | null;
}

/**
 * 本地 GGUF 模型的下载与完整性校验。
 *
 * 从 LocalAiRuntime 拆出的用意：推理进程生命周期与模型文件下载/校验是两条
 * 互不依赖的状态机，留在同一个类里让双方的状态字段互相遮挡。断点续传、
 * 多候选地址探测、SHA256 校验与原子重命名沿用原实现（与 ModelArchiveInstaller
 * 的归档安装流是不同形态：这里保留跨启动的 .sha256.ok 校验结论记忆与
 * downloading/verifying 两阶段进度，故不强行合并到归档安装器）。
 *
 * 下载状态（activeDownload/phase/downloaded/modelErrors）由本类独占：
 * 状态查询、删除模型、推理与测速的互斥判断都从这里读取。
 */
export class LocalModelInstaller {
    private readonly logger = getMainLogger('LocalModelInstaller');
    private activeDownload: { modelId: string; task: Promise<void>; done: Promise<void>; abort: AbortController } | null = null;
    private phase: LocalAiStatus['models'][number]['phase'] = 'idle';
    private downloaded = 0;
    private lastProgressAt = 0;
    /** 每个模型最近一次下载失败原因；成功后清除，切页后仍可查看。 */
    private readonly modelErrors = new Map<string, string>();

    constructor(
        private readonly deps: {
            /** 渲染进程网关：下载进度广播。 */
            rendererGateway: RendererGateway;
            /** 解析模型在媒体库中的安装路径。 */
            resolveModelPath: (model: LocalAiModelDefinition) => Promise<string>;
        }
    ) {}

    /** 查询普通文件大小；只有不存在属于正常未安装状态。 */
    public async fileSize(file: string): Promise<number> {
        try {
            const stat = await fs.promises.stat(file);
            if (!stat.isFile()) throw new Error(`模型路径不是文件：${file}`);
            return stat.size;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
            throw error;
        }
    }

    /** 当前是否有模型正在下载；传入 modelId 时进一步限定该模型。 */
    public get downloadingModelId(): string | null {
        return this.activeDownload?.modelId ?? null;
    }

    /** 模型最近一次下载失败原因；无记录时为 null。 */
    public errorFor(modelId: string): string | null {
        return this.modelErrors.get(modelId) ?? null;
    }

    /**
     * 模型安装产物被移除后的状态清理：丢弃失败记录与进度计数。
     *
     * @param modelId 模型标识。
     */
    public forgetModel(modelId: string): void {
        this.modelErrors.delete(modelId);
        this.downloaded = 0;
    }

    /** 下载状态快照，供状态查询恢复进度展示。 */
    public downloadSnapshot(): LocalModelDownloadSnapshot {
        return {
            phase: this.phase,
            downloadedBytes: this.downloaded,
            modelId: this.activeDownload?.modelId ?? null,
        };
    }

    /** 推送节流后的下载快照；阶段变化和终态始终立即发出。 */
    private emitProgress(modelId: string, force = false): void {
        const now = Date.now();
        if (!force && now - this.lastProgressAt < 100) return;
        this.lastProgressAt = now;
        const model = requireLocalAiModel(modelId);
        this.deps.rendererGateway.fireAndForget('settings/local-ai-model-download-progress', {
            modelId,
            percent: this.downloaded > 0 ? Math.min(100, this.downloaded / model.bytes * 100) : 0,
            downloaded: this.downloaded,
            total: model.bytes,
            phase: this.phase,
        });
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
    public async verifyModelIntegrity(model: LocalAiModelDefinition, modelPath: string, signal?: AbortSignal): Promise<void> {
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

    /**
     * 启动指定模型的下载并保留唯一任务；错误保存在状态中，切页后仍可查看。
     *
     * 忙时（推理/删除进行中）与自定义模型的拒绝检查由调用方完成，这里只负责
     * 下载状态机的推进与退出清理。
     *
     * @param model 待下载的目录模型定义。
     * @param lifetimeSignal 应用生命周期信号；随应用退出中止下载。
     */
    public async download(model: LocalAiModelDefinition, lifetimeSignal: AbortSignal): Promise<void> {
        lifetimeSignal.throwIfAborted();
        const modelId = model.id;
        if (this.activeDownload) throw new Error(`「${this.activeDownload.modelId}」正在下载，请等待完成后再下载其他模型`);
        this.phase = 'downloading';
        this.downloaded = 0;
        this.modelErrors.delete(modelId);
        const abort = new AbortController();
        this.emitProgress(modelId, true);
        const signal = AbortSignal.any([abort.signal, lifetimeSignal]);
        const task = this.install(model, signal);
        let markDone!: () => void;
        const done = new Promise<void>((resolve) => {
            markDone = resolve;
        });
        this.activeDownload = { modelId, task, done, abort };
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
            markDone();
        }
    }

    /** 等待取消完成后再允许重试，避免多个写入器同时操作续传文件。 */
    public async cancelDownload(): Promise<void> {
        const active = this.activeDownload;
        if (!active) return;
        active.abort.abort();
        // 等待外层 finally 完成 activeDownload 清理与终态广播，避免刚 cancel 完成就立即 retry 命中互斥锁。
        await Promise.allSettled([
            active.task.catch((error) => {
                if (!(error instanceof Error) || (error.name !== 'AbortError' && error.name !== 'CanceledError')) {
                    throw error;
                }
            }),
            active.done,
        ]);
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
    public async install(model: LocalAiModelDefinition, signal: AbortSignal): Promise<void> {
        const modelPath = await this.deps.resolveModelPath(model);
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
}
