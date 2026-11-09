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

/** 英语字幕文件名匹配：`xxx.en.srt`、`xxx.en-orig.srt`、`xxx.en-xx.srt` 等。 */
const ENGLISH_SRT_PATTERN = /\.en(?:-[A-Za-z0-9-]+)?\.srt$/i;

/**
 * 允许导入的 YouTube 主机名白名单（精确匹配）。
 *
 * 必须精确匹配而非按后缀匹配：后缀匹配会误收 evil-youtube.com、notyoutube.com
 * 这类仿冒域名，进而把链接交给 yt-dlp 下载任意站点的内容。
 * www. 前缀在解析时统一剥除，因此 www.youtube.com 天然命中。
 */
const YOUTUBE_ALLOWED_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'youtu.be']);

/**
 * 从 YouTube URL 中提取视频 ID；支持 watch?v=、youtu.be/、shorts/、embed/ 四种形态。
 * @param url 用户粘贴的地址。
 * @returns 11 位视频 ID；无法识别时返回 null。
 */
export function parseYoutubeVideoId(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
        const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
        if (!YOUTUBE_ALLOWED_HOSTS.has(host)) return null;
        if (host === 'youtu.be') {
            const id = parsed.pathname.split('/').filter(Boolean)[0];
            return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        }
        const vParam = parsed.searchParams.get('v');
        if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) return vParam;
        const segments = parsed.pathname.split('/').filter(Boolean);
        const marker = segments.findIndex((s) => s === 'shorts' || s === 'embed' || s === 'live');
        if (marker >= 0 && segments[marker + 1] && /^[A-Za-z0-9_-]{11}$/.test(segments[marker + 1])) {
            return segments[marker + 1];
        }
        return null;
    } catch {
        return null;
    }
}

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
        this.settingsStore.set('youtubeImport.enabled', vo.enabled ? 'true' : 'false');
        this.settingsStore.set('youtubeImport.cookiesFilePath', vo.cookiesFilePath.trim());
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
                progress: '导入完成',
                result: JSON.stringify(result),
            });
            this.logger.info('youtube import finished', { job: `download:${videoId}`, taskId, ...result });
        } catch (error) {
            if (error instanceof CancelByUserError) {
                this.dpTaskService.update({ id: taskId, status: DpTaskState.CANCELLED, progress: '任务取消' });
                this.logger.info('youtube import cancelled', { job: `download:${videoId}`, taskId });
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.dpTaskService.fail(taskId, { progress: '导入失败', result: message });
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
                this.dpTaskService.process(taskId, { progress: '该视频已导入过，直接复用' });
                return this.registerVideo(existing.videoPath, existing.srtPaths);
            }

            this.dpTaskService.process(taskId, { progress: '连接 YouTube…' });
            const cookiesFilePath = this.getCookiesFilePath();
            // 信号量必须包住“启动下载”，否则并发任务会同时 spawn yt-dlp。
            const { videoPath, srtPaths } = await concurrency.withSemaphore('yt-dlp', async () => {
                this.dpTaskService.checkCancel(taskId);
                const running = this.ytDlpGateway.download({
                    url,
                    outputDir: workDir,
                    ytDlpBinaryPath,
                    cookiesFilePath: cookiesFilePath || undefined,
                    onProgress: (percent) => {
                        this.dpTaskService.process(taskId, { progress: `下载中 ${percent.toFixed(1)}%` });
                    },
                });
                this.dpTaskService.registerTask(taskId, { cancel: () => running.cancel() });
                return await running.result;
            });

            this.dpTaskService.process(taskId, { progress: '整理下载产物…' });
            const fileName = path.basename(videoPath);
            const targetVideoPath = path.join(targetDir, fileName);
            await this.fileSystemGateway.moveFile(videoPath, targetVideoPath);
            const movedSrtPaths: string[] = [];
            for (const srtPath of srtPaths) {
                const targetSrtPath = path.join(targetDir, path.basename(srtPath));
                await this.fileSystemGateway.moveFile(srtPath, targetSrtPath);
                movedSrtPaths.push(targetSrtPath);
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
        const englishSrt = srtPaths.find((p) => ENGLISH_SRT_PATTERN.test(p));
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
        this.dpTaskService.process(taskId, { progress: '首次使用，正在下载 yt-dlp 组件…' });
        // 先检查取消：在登记取消回调之前就已请求取消的任务，不要再发起无谓的下载。
        this.dpTaskService.checkCancel(taskId);
        // 二进制下载阶段接上取消：否则请求取消只是进了 cancelQueue，下载进程照跑、
        // 轮询还把任务刷回进行中，用户视角是「取消按钮坏了」。
        this.dpTaskService.registerTask(taskId, {
            cancel: () => {
                void this.binaryInstaller.cancelDownload();
            },
        });
        // 安装器只向渲染层事件广播进度，这里轮询状态同步到 dp-task 进度文本。
        const pollTimer = setInterval(() => {
            void this.binaryInstaller.getStatus()
                .then((status) => {
                    if (status.downloading) {
                        this.dpTaskService.process(taskId, { progress: `下载 yt-dlp 组件 ${status.percent}%` });
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
            clearInterval(pollTimer);
        }
        return binaryPath;
    }
}
