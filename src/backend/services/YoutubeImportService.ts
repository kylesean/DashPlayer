import path from 'path';
import { inject, injectable } from 'inversify';
import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import { concurrency } from '@/backend/utils/concurrency';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import type DpTaskService from '@/backend/services/DpTaskService';
import type WatchHistoryService from '@/backend/services/WatchHistoryService';
import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import type YtDlpGateway from '@/backend/services/gateways/ytdlp/YtDlpGateway';
import { ModelArchiveInstaller } from '@/backend/services/models/ModelArchiveInstaller';
import { ytDlpBinaryFileName, ytDlpBinarySha256, ytDlpDownloadUrls } from '@/backend/services/models/ytDlpBinary';
import { DpTaskState } from '@/common/contracts/dp-task';
import { parseYoutubeVideoId } from '@/common/utils/youtubeUrl';
import { pickPreferredEnglishSubtitle } from '@/common/utils/subtitle/preferred-track';
import type {
    YoutubeImportSettingDetailVO,
    YoutubeImportSettingSaveVO,
    YoutubeImportStartResult,
    YoutubeImportTaskResult,
} from '@/common/contracts/youtube-import';

/** 二进制在存储 bin/ 目录下的安装目录名。 */
const YT_DLP_INSTALL_DIRECTORY = 'yt-dlp';

/** 下载产物在视频库中的子目录名。 */
const TARGET_SUB_DIRECTORY = 'YouTube';

/** 首次使用时二进制归档的固定工作目录名（断点续传依赖固定路径）。 */
const BINARY_WORK_DIRECTORY = '.yt-dlp-download';

/** 二进制下载被用户取消时安装器抛出的错误文案；据此把失败归一成取消语义。 */
const BINARY_DOWNLOAD_CANCELLED_MESSAGE = 'yt-dlp 组件下载已取消';

/**
 * 从多个英语字幕文件里挑出最该用的那一个。
 *
 * 具体优先级见 `pickPreferredEnglishSubtitle`：作者上传轨 > ASR 轨 > 其他英语变体。
 *
 * @param paths 候选字幕文件路径。
 * @returns 选中的字幕路径；没有匹配时返回 undefined。
 */
const pickPreferredEnglishSrt = (paths: readonly string[]): string | undefined => {
    const selected = pickPreferredEnglishSubtitle(paths.map((p) => path.basename(p)));
    if (!selected) {
        return undefined;
    }
    return paths.find((p) => path.basename(p) === selected);
};

/**
 * 把 yt-dlp / 系统错误归一成稳定的原因 code，供前端按 code 映射本地化摘要；
 * 原始错误仍写入 result，作为可展开的技术详情。
 *
 * @param message 原始错误文本。
 * @returns 稳定原因 code，未知情况返回 `generic`。
 */
const classifyImportFailure = (message: string): string => {
    if (/429|too many requests|rate.?limit/i.test(message)) return 'rateLimited';
    if (/sign in|login|cookie|bot check|captcha|not a bot/i.test(message)) return 'needCookies';
    if (/country|region|geo.?block|not available in your/i.test(message)) return 'regionBlocked';
    if (/unavailable|private video|removed|deleted|does not exist/i.test(message)) return 'unavailable';
    if (/ENOSPC|no space left|disk full/i.test(message)) return 'diskFull';
    if (/ffmpeg/i.test(message)) return 'ffmpegMissing';
    return 'generic';
};

/**
 * YouTube 导入业务契约。
 */
export default interface YoutubeImportService {
    /**
     * 发起一次 YouTube 链接导入；返回后台任务编号，进度经 dp-task 通道推送。
     * @param url 用户粘贴的 YouTube 视频地址。
     * @returns 任务启动结果。
     */
    start(url: string): Promise<YoutubeImportStartResult>;

    /**
     * 请求取消进行中的导入任务。
     * @param taskId 任务编号。
     * @returns 是否发出了取消请求。
     */
    cancel(taskId: number): Promise<{ cancelled: boolean }>;

    /** @returns YouTube 导入设置详情。 */
    getSettingDetail(): Promise<YoutubeImportSettingDetailVO>;

    /**
     * 保存 YouTube 导入设置。
     * @param vo 保存值。
     * @returns 保存后的设置详情。
     */
    saveSetting(vo: YoutubeImportSettingSaveVO): Promise<YoutubeImportSettingDetailVO>;
}

/**
 * 编排「粘贴 YouTube 链接 → yt-dlp 下载视频与字幕 → 入库挂字幕」的用例服务。
 *
 * 进度与取消复用 DpTaskService；yt-dlp 进程与二进制下载分别抽象在
 * YtDlpGateway 与 ModelArchiveInstaller 中，本类只负责流程编排。
 */
@injectable()
export class YoutubeImportServiceImpl implements YoutubeImportService {
    private readonly logger = getMainLogger('YoutubeImportServiceImpl');
    /** yt-dlp 二进制的下载安装器（懒构建）。 */
    private readonly binaryInstaller: ModelArchiveInstaller;
    /** 进行中的导入任务：videoId → taskId，用于同视频去重。 */
    private readonly activeImports = new Map<string, number>();
    /** 正在等待 yt-dlp 二进制下载的任务集合。 */
    private readonly binaryDownloadWaiters = new Set<number>();

    constructor(
        @inject(TYPES.DpTaskService) private readonly dpTaskService: DpTaskService,
        @inject(TYPES.YtDlpGateway) private readonly ytDlpGateway: YtDlpGateway,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
        @inject(TYPES.SettingsStore) private readonly settingsStore: SettingsStore,
        @inject(TYPES.WatchHistoryService) private readonly watchHistoryService: WatchHistoryService,
        @inject(TYPES.RendererGateway) rendererGateway: RendererGateway,
    ) {
        this.binaryInstaller = new ModelArchiveInstaller(
            {
                downloadUrls: ytDlpDownloadUrls(),
                archiveSha256: ytDlpBinarySha256(),
                workDirectoryName: BINARY_WORK_DIRECTORY,
                archiveFileName: ytDlpBinaryFileName(),
                archiveKind: 'raw',
                modelDirectoryName: YT_DLP_INSTALL_DIRECTORY,
                storageTarget: StorageDirectoryTarget.BIN,
                requiredFiles: [ytDlpBinaryFileName()],
                cancelledMessage: BINARY_DOWNLOAD_CANCELLED_MESSAGE,
                modelDisplayName: 'yt-dlp 组件',
            },
            rendererGateway,
            storageDirectoryProvider,
            fileSystemGateway,
        );
    }

    /** @inheritdoc */
    public async start(url: string): Promise<YoutubeImportStartResult> {
        if (!this.isEnabled()) {
            throw new Error('YouTube 导入功能已在设置中关闭，请先在设置页开启');
        }
        const videoId = parseYoutubeVideoId(url);
        if (!videoId) {
            throw new Error('无法识别的 YouTube 链接，请粘贴完整的视频观看地址（如 https://www.youtube.com/watch?v=xxx）');
        }
        const activeTaskId = this.activeImports.get(videoId);
        if (activeTaskId !== undefined) {
            // 占位值（-1）表示任务编号尚未生成
            throw new Error(activeTaskId === -1
                ? '该视频正在导入中，请等待完成后再试'
                : `该视频正在导入中（任务 #${activeTaskId}），请等待完成后再试`);
        }
        // 先同步占位再异步建任务，消除「检查与登记之间 await」的窗口：
        // 否则两次并发 start 同一视频都会通过检查、各自整段下载。
        this.activeImports.set(videoId, -1);
        let taskId: number;
        try {
            taskId = await this.dpTaskService.create();
        } catch (error) {
            this.activeImports.delete(videoId);
            throw error;
        }
        this.activeImports.set(videoId, taskId);
        // 任务创建时 dp-task 会写入中文占位进度；这里立刻切成结构化阶段，UI 只认 progressMeta。
        this.dpTaskService.process(taskId, { progress: null, progressMeta: { code: 'preparing' } });
        // 后台长任务不继承 IPC 的 traceId，用 job 键标注日志，便于按任务串起整条链路。
        this.logger.info('youtube import start', { job: `download:${videoId}`, taskId, url });
        void this.runImport(taskId, url, videoId)
            .finally(() => this.activeImports.delete(videoId));
        return { taskId };
    }

    /** @inheritdoc */
    public async cancel(taskId: number): Promise<{ cancelled: boolean }> {
        // 只允许取消本服务的导入任务，防止误取消转写等其他功能的任务
        if (![...this.activeImports.values()].includes(taskId)) {
            return { cancelled: false };
        }
        this.dpTaskService.cancel(taskId);
        return { cancelled: true };
    }

    /** @inheritdoc */
    public async getSettingDetail(): Promise<YoutubeImportSettingDetailVO> {
        return { enabled: this.isEnabled(), cookiesFilePath: this.getCookiesFilePath() };
    }

    /** @inheritdoc */
    public async saveSetting(vo: YoutubeImportSettingSaveVO): Promise<YoutubeImportSettingDetailVO> {
        const trimmedCookiesPath = vo.cookiesFilePath.trim();
        if (trimmedCookiesPath && path.extname(trimmedCookiesPath).toLowerCase() !== '.txt') {
            throw new Error('Cookies 文件只接受 .txt 格式');
        }
        this.settingsStore.set('youtubeImport.enabled', vo.enabled ? 'true' : 'false');
        this.settingsStore.set('youtubeImport.cookiesFilePath', trimmedCookiesPath);
        return { enabled: this.isEnabled(), cookiesFilePath: this.getCookiesFilePath() };
    }

    /** @returns 功能开关是否开启。 */
    private isEnabled(): boolean {
        return this.settingsStore.get('youtubeImport.enabled') === 'true';
    }

    /** @returns 用户配置的 cookies.txt 路径；未配置时为空串。 */
    private getCookiesFilePath(): string {
        return this.settingsStore.get('youtubeImport.cookiesFilePath') ?? '';
    }

    /**
     * 执行一次完整导入；任何失败都落入任务失败态，取消落入取消态。
     */
    private async runImport(taskId: number, url: string, videoId: string): Promise<void> {
        try {
            const result = await this.importVideo(taskId, url, videoId);
            this.dpTaskService.finish(taskId, {
                progress: null,
                progressMeta: { code: 'done' },
                result: JSON.stringify(result),
            });
            this.logger.info('youtube import finished', { job: `download:${videoId}`, taskId, ...result });
        } catch (error) {
            if (error instanceof CancelByUserError) {
                this.dpTaskService.update({
                    id: taskId,
                    status: DpTaskState.CANCELLED,
                    progress: null,
                    progressMeta: { code: 'cancelled' },
                });
                this.logger.info('youtube import cancelled', { job: `download:${videoId}`, taskId });
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.dpTaskService.fail(taskId, {
                progress: null,
                progressMeta: { code: 'failed', params: { reason: classifyImportFailure(message) } },
                result: message,
            });
            this.logger.error('youtube import failed', { job: `download:${videoId}`, taskId, error });
        }
    }

    /**
     * 导入主流程：确保 yt-dlp 二进制 → 下载到临时目录 → 移入视频库 → 入库挂字幕。
     */
    private async importVideo(taskId: number, url: string, videoId: string): Promise<YoutubeImportTaskResult> {
        const ytDlpBinaryPath = await this.ensureYtDlpBinary(taskId);
        this.dpTaskService.checkCancel(taskId);

        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const workDir = path.join(tempRoot, `youtube-${videoId}-${Date.now()}`);
        await this.fileSystemGateway.ensureDirectory(workDir);
        // 无论成败都清理临时工作目录：失败/取消路径不能把 GB 级半成品永久留在 temp
        try {
            const targetDir = path.join(
                await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.VIDEOS),
                TARGET_SUB_DIRECTORY,
            );
            await this.fileSystemGateway.ensureDirectory(targetDir);

            // 已导入过同一视频时直接复用库内产物，避免重复下载与重复记录。
            const existing = await this.findExistingVideo(targetDir, videoId);
            if (existing) {
                this.dpTaskService.process(taskId, { progress: null, progressMeta: { code: 'reusing' } });
                return this.registerVideo(existing.videoPath, existing.srtPaths);
            }

            const cookiesFilePath = this.getCookiesFilePath();
            // 信号量必须包住“启动下载”，否则并发任务会同时 spawn yt-dlp。
            const queue = concurrency.semaphore('yt-dlp').snapshot();
            if (queue.inUse >= queue.capacity || queue.waiting > 0) {
                this.dpTaskService.process(taskId, { progress: null, progressMeta: { code: 'queued' } });
            }
            const { videoPath, srtPaths } = await concurrency.withSemaphore('yt-dlp', async () => {
                this.dpTaskService.process(taskId, { progress: null, progressMeta: { code: 'connecting' } });
                this.dpTaskService.checkCancel(taskId);
                const running = this.ytDlpGateway.download({
                    url,
                    outputDir: workDir,
                    ytDlpBinaryPath,
                    cookiesFilePath: cookiesFilePath || undefined,
                    onProgress: (percent) => {
                        this.dpTaskService.process(taskId, {
                            progress: null,
                            progressMeta: { code: 'downloading', percent },
                        });
                    },
                });
                this.dpTaskService.registerTask(taskId, { cancel: () => running.cancel() });
                return await running.result;
            });

            this.dpTaskService.process(taskId, { progress: null, progressMeta: { code: 'finalizing' } });
            this.dpTaskService.checkCancel(taskId);
            const fileName = path.basename(videoPath);
            const targetVideoPath = path.join(targetDir, fileName);
            await this.fileSystemGateway.moveFile(videoPath, targetVideoPath);
            const movedSrtPaths: string[] = [];
            try {
                for (const srtPath of srtPaths) {
                    this.dpTaskService.checkCancel(taskId);
                    const targetSrtPath = path.join(targetDir, path.basename(srtPath));
                    await this.fileSystemGateway.moveFile(srtPath, targetSrtPath);
                    movedSrtPaths.push(targetSrtPath);
                }
                this.dpTaskService.checkCancel(taskId);
            } catch (error) {
                if (error instanceof CancelByUserError) {
                    await this.fileSystemGateway.removeFileIfExists(targetVideoPath).catch(() => undefined);
                    for (const movedSrt of movedSrtPaths) {
                        await this.fileSystemGateway.removeFileIfExists(movedSrt).catch(() => undefined);
                    }
                }
                throw error;
            }

            return this.registerVideo(targetVideoPath, movedSrtPaths);
        } finally {
            await this.fileSystemGateway.removeDirectoryIfExists(workDir);
        }
    }

    /**
     * 将视频注册进观看历史并挂载英语字幕。
     */
    private async registerVideo(videoPath: string, srtPaths: string[]): Promise<YoutubeImportTaskResult> {
        const ids = await this.watchHistoryService.create([videoPath]);
        const videoId = ids[0];
        const englishSrt = pickPreferredEnglishSrt(srtPaths);
        if (englishSrt) {
            await this.watchHistoryService.attachSrt(videoPath, englishSrt);
        } else if (srtPaths.length === 0) {
            this.logger.warn('youtube import produced no srt; user can transcribe in player', { videoPath });
        } else {
            this.logger.warn('youtube import produced srt but none matched english track', {
                videoPath,
                srtFiles: srtPaths.map((p) => path.basename(p)),
            });
        }
        return {
            videoId,
            fileName: path.basename(videoPath),
            attachedSrtFileName: englishSrt ? path.basename(englishSrt) : null,
        };
    }

    /**
     * 在视频库目标目录中查找已导入的同视频产物（文件名含 `[videoId]`）。
     */
    private async findExistingVideo(
        targetDir: string,
        videoId: string,
    ): Promise<{ videoPath: string; srtPaths: string[] } | null> {
        const names = await this.fileSystemGateway.listFileNames(targetDir);
        const marker = `[${videoId}]`;
        const videoName = names.find((name) => name.includes(marker)
            && ['.mp4', '.mkv', '.webm'].some((ext) => name.toLowerCase().endsWith(ext)));
        if (!videoName) return null;
        const baseName = videoName.replace(/\.[^.]+$/, '');
        const srtNames = names.filter((name) => name.toLowerCase().endsWith('.srt') && name.startsWith(baseName));
        return {
            videoPath: path.join(targetDir, videoName),
            srtPaths: srtNames.map((name) => path.join(targetDir, name)),
        };
    }

    /**
     * 确保 yt-dlp 二进制就绪；缺失时经 ModelArchiveInstaller 下载安装（带进度回传）。
     * @param taskId 用于回传二进制下载进度的任务编号。
     * @returns 二进制绝对路径。
     */
    private async ensureYtDlpBinary(taskId: number): Promise<string> {
        const binRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.BIN);
        const binaryPath = path.join(binRoot, YT_DLP_INSTALL_DIRECTORY, ytDlpBinaryFileName());
        if (!(await this.fileSystemGateway.pathIsMissing(binaryPath))) {
            return binaryPath;
        }
        this.dpTaskService.process(taskId, { progress: null, progressMeta: { code: 'preparing' } });
        // 先检查取消：在登记取消回调之前就已请求取消的任务，不要再发起无谓的下载。
        this.dpTaskService.checkCancel(taskId);
        this.binaryDownloadWaiters.add(taskId);
        // 二进制下载阶段接上取消：仅当所有等待该二进制的任务都已取消时才终止底层下载，
        // 且二进制下载完成后立即失效，避免后续视频下载阶段取消误伤其他任务的组件安装。
        this.dpTaskService.registerTask(taskId, {
            cancel: () => {
                if (!this.binaryDownloadWaiters.delete(taskId)) {
                    return;
                }
                if (this.binaryDownloadWaiters.size === 0) {
                    void this.binaryInstaller.cancelDownload();
                }
            },
        });
        // 安装器只向渲染层事件广播进度，这里轮询状态同步到 dp-task 进度文本。
        let pollingActive = true;
        const pollTimer = setInterval(() => {
            void this.binaryInstaller.getStatus()
                .then((status) => {
                    if (!pollingActive || !this.binaryDownloadWaiters.has(taskId)) {
                        return;
                    }
                    if (status.downloading) {
                        this.dpTaskService.process(taskId, {
                            progress: null,
                            progressMeta: { code: 'binaryDownload', percent: status.percent },
                        });
                    }
                })
                .catch(() => undefined);
        }, 500);
        try {
            const result = await this.binaryInstaller.download();
            if (!result.success) {
                throw new Error(result.message);
            }
        } catch (error) {
            // 安装器把取消表达为普通错误，这里归一成取消语义，让任务进 CANCELLED 而非 FAILED
            if (error instanceof Error && error.message === BINARY_DOWNLOAD_CANCELLED_MESSAGE) {
                throw new CancelByUserError(error.message);
            }
            throw error;
        } finally {
            pollingActive = false;
            this.binaryDownloadWaiters.delete(taskId);
            clearInterval(pollTimer);
        }
        return binaryPath;
    }
}
