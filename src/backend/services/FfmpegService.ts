import { inject, injectable } from 'inversify';
import { WithSemaphore } from '@/backend/utils/concurrency/decorators';
import { randomUUID } from 'crypto';
import path from 'path';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type { VideoInfo } from '@/common/types/video-info';
import { CancelByUserError } from '@/backend/utils/errors/errors';
import type FfmpegGateway from '@/backend/services/gateways/media/FfmpegGateway';
import { FfmpegExecutionError } from '@/backend/services/gateways/media/FfmpegGateway';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';

export default interface FfmpegService {
    duration(filePath: string): Promise<number>;

    /**
     * 生成缩略图；截图点超出视频长度时自动钳制到结尾前，时长由方法自行探测。
     */
    thumbnail({
                  inputFile,
                  outputFileName,
                  outputFolder,
                  time,
                  options
              }: {
        inputFile: string,
        outputFileName: string,
        outputFolder: string,
        time: number,
        options?: {
            quality?: 'low' | 'medium' | 'high' | 'ultra';
            width?: number;
            format?: 'jpg' | 'png';
        }
    }): Promise<void>;

    
    /**
     * 提取文本字幕；英语学习场景优先英文字幕轨，无匹配时回退第一条文本字幕。
     *
     * @param args.job 日志检索键，与所属修复任务共用。
     * @param args.registerCancel 取消句柄注册回调；调用方收到 cancel 后可终止本次执行。
     * @returns 成功提取时返回 true；源媒体没有可转 srt 的文本字幕时返回 false。
     */
    extractSubtitles({
                         job,
                         inputFile,
                         outputFile,
                         onProgress,
                         registerCancel
                     }: {
        job: string,
        inputFile: string,
        outputFile?: string,
        onProgress?: (progress: number) => void,
        registerCancel?: (cancel: () => void) => void
    }): Promise<boolean>;

    trimVideo(inputPath: string, startTime: number, endTime: number, outputPath: string, job?: string): Promise<void>;

    /**
     * 获取视频信息。
     */
    getVideoInfo(filePath: string): Promise<VideoInfo>;

    /**
     * 转换音频文件为 WAV 格式。
     */
    convertToWav(inputPath: string, outputPath: string): Promise<void>;

    /**
     * 将媒体按时间范围直接转换为 16kHz 单声道 PCM WAV 分片。
     */
    createRecognitionWavChunks(args: {
        inputFile: string;
        ranges: Array<{ start: number; end: number }>;
        outputFolder: string;
        job?: string;
        isCancelled?: () => boolean;
        registerCancel?: (cancel: () => void) => void;
    }): Promise<string[]>;

}


/**
 * FFmpeg 业务服务实现。
 */
@injectable()
export class FfmpegServiceImpl implements FfmpegService {
    private readonly logger = getMainLogger('FfmpegServiceImpl');

    /**
     * 构造 FFmpeg 业务服务。
     *
     * @param ffmpegGateway FFmpeg 底层命令网关。
     * @param storageDirectoryProvider 外部存储目录提供器。
     * @param fileSystemGateway 文件系统访问端口。
     */
    constructor(
        @inject(TYPES.FfmpegGateway) private readonly ffmpegGateway: FfmpegGateway,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    /**
     * 获取视频时长。
     */
    @WithSemaphore('ffprobe')
    public async duration(filePath: string): Promise<number> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(filePath);
        return await this.ffmpegGateway.duration(filePath);
    }

    /**
     * 获取视频信息。
     */
    @WithSemaphore('ffprobe')
    public async getVideoInfo(filePath: string): Promise<VideoInfo> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(filePath);
        return await this.ffmpegGateway.getVideoInfo(filePath);
    }

    /**
     * 生成缩略图；截图点超出视频长度时自动钳制到结尾前。
     */
    @WithSemaphore('ffmpeg')
    public async thumbnail({
                               inputFile,
                               outputFileName,
                               outputFolder,
                               time,
                               options = {},
                           }: {
        inputFile: string,
        outputFileName: string,
        outputFolder: string,
        time: number,
        options?: {
            quality?: 'low' | 'medium' | 'high' | 'ultra';
            width?: number;
            format?: 'jpg' | 'png';
        },
    }): Promise<void> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(inputFile);
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(outputFolder);
        await this.fileSystemGateway.ensureDirectory(outputFolder);

        // 时长由方法自行探测，截图点钳制到视频结尾前，避免超出时长后 ffmpeg 静默产出空图。
        const totalDuration = await this.duration(inputFile);
        const actualTime = Math.min(time, totalDuration);

        const outputFile = path.join(outputFolder, outputFileName);
        const qualitySettings: Record<'low' | 'medium' | 'high' | 'ultra', { width: number; jpgQScale: number }> = {
            low: { width: 320, jpgQScale: 6 },
            medium: { width: 640, jpgQScale: 4 },
            high: { width: 1280, jpgQScale: 3 },
            ultra: { width: 1920, jpgQScale: 2 },
        };
        const quality = options.quality ?? 'medium';
        const preset = qualitySettings[quality];

        await this.ffmpegGateway.createThumbnail(
            {
                inputFile,
                outputFile,
                timeSecond: actualTime,
                width: options.width ?? preset.width,
                format: options.format ?? 'jpg',
                jpgQScale: preset.jpgQScale,
            },
        );
    }

    /**
     * 按配方修复媒体文件。
     *
     * @param args.job 日志检索键，把一次修复的子进程日志串起来。
     * @param args.inputFile 输入媒体绝对路径。
     * @param args.outputFile 修复产物绝对路径。
     * @param args.recipe 修复配方。
     * @param args.onProgress ffmpeg 进度回调，单位为百分比。
     * @param args.registerCancel 取消句柄注册回调；调用方收到 cancel 后可终止本次执行。
     * @returns 修复产物路径。
     */

    /**
     * 提取文本字幕；优先英文字幕轨，无匹配时由网关回退第一条文本字幕，返回是否提取到。
     */
    @WithSemaphore('ffmpeg')
    public async extractSubtitles({
                                      job,
                                      inputFile,
                                      outputFile,
                                      onProgress,
                                      registerCancel,
                                  }: {
        job: string,
        inputFile: string,
        outputFile?: string,
        onProgress?: (progress: number) => void,
        registerCancel?: (cancel: () => void) => void,
    }): Promise<boolean> {
        const finalOutputFile = outputFile ?? inputFile.replace(path.extname(inputFile), '.srt');
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(inputFile);
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(finalOutputFile);

        let extracted = false;
        await this.runCancelableTask(job, registerCancel, async (onCancelable) => {
            extracted = await this.ffmpegGateway.extractSubtitles(
                {
                    inputFile,
                    outputFile: finalOutputFile,
                    // 英语学习场景优先英文字幕，无匹配时回退第一条文本字幕。
                    preferLanguage: 'eng',
                },
                {
                    onProgress,
                    onCancelable,
                    job,
                },
            );
        });
        return extracted;
    }

    /**
     * 裁剪视频。
     * @param inputPath 源视频绝对路径。
     * @param startTime 起始时间（秒）。
     * @param endTime 结束时间（秒）。
     * @param outputPath 输出视频绝对路径。
     * @param job 所属后台任务身份标识，如 `clip:<clipKey>`。
     */
    @WithSemaphore('ffmpeg')
    public async trimVideo(
        inputPath: string,
        startTime: number,
        endTime: number,
        outputPath: string,
        job?: string,
    ): Promise<void> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(inputPath);
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(outputPath);
        await this.ffmpegGateway.trimVideo({
            inputFile: inputPath,
            outputFile: outputPath,
            startSecond: startTime,
            endSecond: endTime,
            videoCodec: 'libx265',
            // x265 默认 medium 预设极慢；短片段用 veryfast 提速明显且质量差异不可感知。
            videoPreset: 'veryfast',
            audioCodec: 'aac',
            outputWidth: 640,
            crf: 28,
            audioChannels: 1,
            audioBitrate: '64k',
        }, { job });
    }

    /**
     * 转换音频文件为 WAV 格式（强制 16kHz、单声道、16-bit PCM）。
     */
    @WithSemaphore('ffmpeg')
    public async convertToWav(inputPath: string, outputPath: string): Promise<void> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(inputPath);
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(outputPath);
        await this.ffmpegGateway.convertToWav({
            inputFile: inputPath,
            outputFile: outputPath,
            sampleRate: 16000,
            channels: 1,
        });
    }

    /**
     * 将媒体直接裁剪并转换为语音识别需要的 WAV 分片，避免有损中间格式和嵌套信号量。
     * @param args 输入媒体、分片时间范围和输出目录。
     * @returns 与时间范围顺序一致的 WAV 文件路径。
     */
    @WithSemaphore('ffmpeg')
    public async createRecognitionWavChunks(args: {
        inputFile: string;
        ranges: Array<{ start: number; end: number }>;
        outputFolder: string;
        job?: string;
        isCancelled?: () => boolean;
        registerCancel?: (cancel: () => void) => void;
    }): Promise<string[]> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(args.inputFile);
        await this.fileSystemGateway.ensureDirectory(args.outputFolder);
        const outputs: string[] = [];
        for (let index = 0; index < args.ranges.length; index++) {
            if (args.isCancelled?.()) {
                throw new CancelByUserError();
            }
            const range = args.ranges[index];
            const outputPath = path.join(args.outputFolder, `parakeet_${String(index + 1).padStart(3, '0')}.wav`);
            await this.runCancelableTask(
                args.job ?? `wav-chunk:${index}`,
                args.registerCancel,
                async (onCancelable) => {
                    await this.ffmpegGateway.convertToWav({
                        inputFile: args.inputFile,
                        outputFile: outputPath,
                        sampleRate: 16000,
                        channels: 1,
                        startSecond: range.start,
                        endSecond: range.end,
                    }, {
                        job: args.job,
                        onCancelable,
                    });
                },
            );
            outputs.push(outputPath);
        }
        return outputs;
    }

    /**
     * 执行支持取消的任务，并统一处理取消异常。
     * @param job 日志检索键，用于异常日志归因。
     * @param registerCancel 调用方的取消句柄注册回调；收到 cancel 即代表用户请求取消。
     * @param runner 接收取消注册回调的任务体。
     */
    private async runCancelableTask(
        job: string,
        registerCancel: ((cancel: () => void) => void) | undefined,
        runner: (onCancelable: (cancel: () => void) => void) => Promise<void>,
    ): Promise<void> {
        let cancelledByUser = false;
        let hasCancelable = false;

        const onCancelable = (cancel: () => void): void => {
            hasCancelable = true;
            registerCancel?.(() => {
                cancelledByUser = true;
                cancel();
            });
        };

        try {
            await runner(onCancelable);
            return;
        } catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            // 子进程退出与取消已由网关作为唯一证据点记录，这里只补记网关看不到的任务体异常。
            const alreadyReported = error instanceof FfmpegExecutionError
                || error instanceof CancelByUserError
                || cancelledByUser;
            if (!alreadyReported) {
                this.logger.error('ffmpeg task failed', { job, error: normalized });
            }
            throw this.processError(normalized, cancelledByUser);
        } finally {
            if (!hasCancelable) {
                this.logger.debug('ffmpeg task finished without cancel handle', { job });
            }
        }
    }

    /**
     * 统一错误处理。
     * @param error 任务体抛出的异常。
     * @param cancelledByUser 任务是否已被用户标记取消。
     * @returns 取消场景归一为 CancelByUserError，其余原样透出。
     */
    private processError(error: Error, cancelledByUser = false): Error {
        if (cancelledByUser) {
            return new CancelByUserError();
        }

        return error;
    }
}
