import path from 'path';
import { inject, injectable } from 'inversify';
import { getMainLogger } from '@/backend/infrastructure/logger';
import TYPES from '@/backend/ioc/types';
import type DpTaskService from '@/backend/services/DpTaskService';
import type FfmpegService from '@/backend/services/FfmpegService';
import type WatchHistoryService from '@/backend/services/WatchHistoryService';
import type TranscriptionEngineSelector from '@/backend/services/TranscriptionEngineSelector';
import type SpeechRecognitionGateway from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import type { SpeechRecognitionToken } from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import EnglishSubtitleSegmenter from '@/backend/utils/subtitle/EnglishSubtitleSegmenter';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import { DpTaskState } from '@/common/contracts/dp-task';
import { toSrtContent } from '@/common/utils/subtitle/parser';

/** 单个识别分片的目标时长（秒）。 */
const CHUNK_SECONDS = 300;
/** 相邻分片的重叠时长（秒）：保证切分边界处的单词完整出现在某一侧。 */
const CHUNK_OVERLAP_SECONDS = 1;

/**
 * 为无字幕视频生成英文字幕的业务契约。
 */
export default interface SubtitleGenerationService {
    /**
     * 启动一次字幕生成后台任务。
     *
     * @param videoId 观看历史记录 ID。
     * @returns 后台任务 ID；进度与结果经 dp-task 推送。
     */
    start(videoId: string): Promise<number>;

    /**
     * 取消指定任务并终止底层识别进程。
     *
     * @param taskId 后台任务 ID。
     */
    cancel(taskId: number): void;
}

/**
 * 最小编排：抽取音频分片 → 本地 ASR 识别 → 意群分句 → 写 SRT 并挂到视频。
 *
 * 刻意不实现上游的「按播放位置重排分片」与「增量字幕展示」：本 fork 的定位是
 * 整段生成后一次性可用，减少会话与增量通路带来的复杂度。
 */
@injectable()
export class SubtitleGenerationServiceImpl implements SubtitleGenerationService {
    private readonly logger = getMainLogger('SubtitleGenerationService');
    private readonly segmenter = new EnglishSubtitleSegmenter();
    /** 任务 ID → 当前使用的识别网关，取消时用于终止底层进程。 */
    private readonly gatewayByTask = new Map<number, SpeechRecognitionGateway>();
    /** 已请求取消的任务集合；供识别网关的 isCancelled 轮询。 */
    private readonly cancelledTasks = new Set<number>();
    /** 正在生成字幕的视频路径集合，防止同一视频并发生成互相覆盖。 */
    private readonly activeVideos = new Set<string>();

    constructor(
        @inject(TYPES.DpTaskService) private readonly dpTaskService: DpTaskService,
        @inject(TYPES.WatchHistoryService) private readonly watchHistoryService: WatchHistoryService,
        @inject(TYPES.FfmpegService) private readonly ffmpegService: FfmpegService,
        @inject(TYPES.TranscriptionEngineSelector) private readonly engineSelector: TranscriptionEngineSelector,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    /**
     * 启动字幕生成任务。
     *
     * @param videoId 观看历史记录 ID。
     * @returns 后台任务 ID。
     * @throws 视频不存在或同名 SRT 已存在时抛出，不做静默覆盖。
     */
    public async start(videoId: string): Promise<number> {
        const videoPath = await this.watchHistoryService.videoPath(videoId);
        if (this.activeVideos.has(videoPath)) {
            throw new Error('该视频正在生成字幕中，请等待完成后再试');
        }
        const srtPath = this.srtPathOf(videoPath);
        if (await this.fileSystemGateway.fileExists(srtPath)) {
            throw new Error(`字幕文件已存在：${srtPath}`);
        }
        this.activeVideos.add(videoPath);
        let taskId: number;
        try {
            taskId = await this.dpTaskService.create();
        } catch (error) {
            this.activeVideos.delete(videoPath);
            throw error;
        }
        void this.run(taskId, videoPath, srtPath);
        return taskId;
    }

    /**
     * 取消任务：同时标记轮询状态并终止底层识别进程。
     *
     * @param taskId 后台任务 ID。
     */
    public cancel(taskId: number): void {
        this.cancelledTasks.add(taskId);
        this.dpTaskService.cancel(taskId);
        this.gatewayByTask.get(taskId)?.cancelActive(this.jobOf(taskId));
    }

    /** 与视频同目录同名的 SRT 路径。 */
    private srtPathOf(videoPath: string): string {
        return path.join(
            path.dirname(videoPath),
            `${path.basename(videoPath, path.extname(videoPath))}.srt`,
        );
    }

    /** 日志与进程检索键；每个任务唯一。 */
    private jobOf(taskId: number): string {
        return `subtitle-generation:${taskId}`;
    }

    /**
     * 任务主体：分片识别、合并分句、落盘并挂载。
     *
     * @param taskId 后台任务 ID。
     * @param videoPath 视频绝对路径。
     * @param srtPath 目标字幕路径。
     */
    private async run(taskId: number, videoPath: string, srtPath: string): Promise<void> {
        const job = this.jobOf(taskId);
        let tempFolder: string | null = null;
        try {
            const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
            const gateway = this.engineSelector.select();
            this.gatewayByTask.set(taskId, gateway);
            this.dpTaskService.registerTask(taskId, {
                cancel: () => {
                    this.cancelledTasks.add(taskId);
                    gateway.cancelActive(job);
                },
            });

            this.dpTaskService.process(taskId, { progress: '读取媒体时长…' });
            const duration = await this.ffmpegService.duration(videoPath);
            if (!Number.isFinite(duration) || duration <= 0) {
                throw new Error(`无法读取媒体时长：${duration}`);
            }

            const ranges: Array<{ start: number; end: number }> = [];
            for (let start = 0; start < duration; start += CHUNK_SECONDS) {
                ranges.push({
                    start: Math.max(0, start - CHUNK_OVERLAP_SECONDS),
                    end: Math.min(duration, start + CHUNK_SECONDS),
                });
            }

            this.dpTaskService.checkCancel(taskId);
            const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
            tempFolder = path.join(tempRoot, 'subtitle-generation', String(taskId));
            const wavPaths = await this.ffmpegService.createRecognitionWavChunks({
                inputFile: videoPath,
                ranges,
                outputFolder: tempFolder,
                job,
                isCancelled: () => this.cancelledTasks.has(taskId),
                registerCancel: (cancel) => this.dpTaskService.registerTask(taskId, { cancel }),
            });

            const timelines: SpeechRecognitionToken[][] = [];
            for (let index = 0; index < wavPaths.length; index++) {
                this.dpTaskService.checkCancel(taskId);
                const percent = Math.floor((index / Math.max(wavPaths.length, 1)) * 100);
                this.dpTaskService.process(taskId, {
                    progress: `识别中 ${index + 1}/${wavPaths.length}（${percent}%）`,
                });
                const result = await gateway.transcribe({
                    audioPath: wavPaths[index],
                    modelsRoot,
                    job,
                    isCancelled: () => this.cancelledTasks.has(taskId),
                });
                const offset = ranges[index].start;
                timelines.push(result.tokens.map((token) => ({
                    ...token,
                    start: token.start + offset,
                    end: token.end === undefined ? undefined : token.end + offset,
                })));
            }

            this.dpTaskService.checkCancel(taskId);
            this.dpTaskService.process(taskId, { progress: '整理字幕…' });

            const merged = this.segmenter.mergeTimelines(timelines, ranges.map((range) => range.start));
            const lines = this.segmenter.segmentTimeline(merged)
                .map((line, index) => ({ ...line, index: index + 1 }));
            if (lines.length === 0) {
                throw new Error('未识别到任何语音内容');
            }

            await this.fileSystemGateway.writeTextFile(srtPath, toSrtContent(lines));
            await this.watchHistoryService.attachSrt(videoPath, srtPath);

            this.logger.info('subtitle generated', { job, lines: lines.length, srtPath });
            this.dpTaskService.finish(taskId, { progress: '字幕生成完成', result: srtPath });
        } catch (error) {
            if (error instanceof CancelByUserError) {
                this.dpTaskService.update({ id: taskId, status: DpTaskState.CANCELLED, progress: '任务取消' });
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('subtitle generation failed', { job, error: message });
            this.dpTaskService.fail(taskId, { progress: '字幕生成失败', result: message });
        } finally {
            this.activeVideos.delete(videoPath);
            this.gatewayByTask.delete(taskId);
            this.cancelledTasks.delete(taskId);
            if (tempFolder) {
                try {
                    await this.fileSystemGateway.removeDirectoryIfExists(tempFolder);
                } catch (cleanupError) {
                    this.logger.warn('subtitle generation temp cleanup failed', { job, error: cleanupError });
                }
            }
        }
    }
}
