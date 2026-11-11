import path from 'path';
import { inject, injectable } from 'inversify';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type FfmpegService from '@/backend/services/FfmpegService';
import type MediaPathRegistry from '@/backend/services/MediaPathRegistry';
import { isPathInsideRoot } from '@/backend/infrastructure/media/MediaProtocol';
import TYPES from '@/backend/ioc/types';
import { ObjUtil } from '@/backend/utils/ObjUtil';
import type { VideoInfo } from '@/common/types/video-info';

/** 缩略图清晰度。 */
export type ThumbnailQuality = 'low' | 'medium' | 'high' | 'ultra';

/** 缩略图生成参数。 */
export interface ThumbnailOptions {
    /** 预设清晰度。 */
    quality?: ThumbnailQuality;
    /** 输出宽度，单位为像素。 */
    width?: number;
    /** 输出图片格式。 */
    format?: 'jpg' | 'png';
}/**
 * MediaService 的业务契约。
 */
export default interface MediaService {
    /**
     * 获取或生成媒体缩略图。
     *
     * 相同文件、时间和选项会复用已有的非空缩略图；空文件会被删除后重新生成。
     *
     * @param sourceFilePath 媒体文件绝对路径。
     * @param timestamp 截图时间，单位为秒；未提供时使用视频中点附近。
     * @param options 缩略图清晰度、宽度和格式。
     * @returns 缩略图文件绝对路径。
     */
    thumbnail(sourceFilePath: string, timestamp?: number, options?: ThumbnailOptions): Promise<string>;

    /**
     * 获取媒体文件时长。
     * @param inputFile 媒体文件绝对路径。
     * @returns 媒体时长，单位为秒。
     */
    duration(inputFile: string): Promise<number>;

    /**
     * 获取媒体文件信息。
     * @param inputFile 媒体文件绝对路径。
     * @returns FFprobe 解析后的媒体信息。
     */
    info(inputFile: string): Promise<VideoInfo>;
}



/**
 * 提供媒体文件信息、时长读取和缩略图生成能力。
 */
@injectable()
export class MediaServiceImpl implements MediaService {
    private readonly durationCache = new Map<string, number>();
    private readonly inFlightThumbnails = new Map<string, Promise<string>>();

    public constructor(
        @inject(TYPES.StorageDirectoryProvider)
        private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FfmpegService)
        private readonly ffmpegService: FfmpegService,
        @inject(TYPES.FileSystemGateway)
        private readonly fileSystemGateway: FileSystemGateway,
        @inject(TYPES.MediaPathRegistry)
        private readonly mediaPathRegistry: MediaPathRegistry,
    ) {}

    /**
     * 获取或生成媒体缩略图。
     *
     * 相同文件、时间和选项会复用已有的非空缩略图；空文件会被删除后重新生成。
     *
     * @param sourceFilePath 媒体文件绝对路径。
     * @param timestamp 截图时间，单位为秒；未提供时使用视频中点附近。
     * @param options 缩略图清晰度、宽度和格式。
     * @returns 缩略图文件绝对路径。
     */
    public async thumbnail(
        sourceFilePath: string,
        timestamp?: number,
        options: ThumbnailOptions = {},
    ): Promise<string> {
        const cacheKey = `${sourceFilePath}::${timestamp ?? ''}::${JSON.stringify(options)}`;
        const inFlight = this.inFlightThumbnails.get(cacheKey);
        if (inFlight) {
            return inFlight;
        }

        const task = this.generateThumbnail(sourceFilePath, timestamp, options);
        this.inFlightThumbnails.set(cacheKey, task);
        try {
            return await task;
        } finally {
            this.inFlightThumbnails.delete(cacheKey);
        }
    }

    private async generateThumbnail(
        sourceFilePath: string,
        timestamp?: number,
        options: ThumbnailOptions = {},
    ): Promise<string> {
        await this.assertMediaPathAllowed(sourceFilePath);
        await this.assertSourceFileExists(sourceFilePath);
        const duration = await this.readPositiveDuration(sourceFilePath);
        const adjustedTimestamp = this.calculateAdjustedTimestamp(timestamp, duration);
        const tempDirectory = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const thumbnailPath = this.buildThumbnailPath(
            tempDirectory,
            sourceFilePath,
            adjustedTimestamp,
            options,
        );

        if (await this.fileSystemGateway.fileExists(thumbnailPath)) {
            if (await this.fileSystemGateway.getFileSize(thumbnailPath) > 0) {
                return thumbnailPath;
            }
            await this.fileSystemGateway.removeFileIfExists(thumbnailPath);
        }

        await this.ffmpegService.thumbnail({
            inputFile: sourceFilePath,
            outputFolder: tempDirectory,
            outputFileName: path.basename(thumbnailPath),
            time: adjustedTimestamp,
            options,
        });

        if (
            !(await this.fileSystemGateway.fileExists(thumbnailPath))
            || await this.fileSystemGateway.getFileSize(thumbnailPath) === 0
        ) {
            throw new Error(`缩略图生成失败：${thumbnailPath}`);
        }

        return thumbnailPath;
    }

    /**
     * 获取媒体文件时长。
     * @param inputFile 媒体文件绝对路径。
     * @returns 媒体时长，单位为秒。
     */
    public async duration(inputFile: string): Promise<number> {
        await this.assertMediaPathAllowed(inputFile);
        await this.assertSourceFileExists(inputFile);
        return this.readPositiveDuration(inputFile);
    }

    /**
     * 获取媒体文件信息。
     * @param inputFile 媒体文件绝对路径。
     * @returns FFprobe 解析后的媒体信息。
     */
    public async info(inputFile: string): Promise<VideoInfo> {
        await this.assertMediaPathAllowed(inputFile);
        await this.assertSourceFileExists(inputFile);
        return this.ffmpegService.getVideoInfo(inputFile);
    }

    /**
     * 校验媒体文件存在且为普通文件。
     * @param sourceFilePath 媒体文件绝对路径。
     */
    private async assertSourceFileExists(sourceFilePath: string): Promise<void> {
        await this.storageDirectoryProvider.ensurePathAccessPermissionIfExists(sourceFilePath);
        if (!(await this.fileSystemGateway.fileExists(sourceFilePath))) {
            throw new Error(`媒体文件不存在：${sourceFilePath}`);
        }
    }

    /**
     * 校验调用方给的媒体路径确实属于「后端交付过或媒体库内」的范围。
     *
     * 这三条路由（thumbnail / duration / info）会把任意路径交给 ffmpeg/ffprobe 解析，
     * 缩略图还会落到媒体库 temp 目录、随后可经 `media://` 读回。只做「存在性」校验
     * 等于给渲染层一个任意文件探测与画面读取的通道，与其它路由（字幕、词汇表）
     * 已经采用的路径约束不一致。
     *
     * 放行条件与 `media://` 协议保持一致：路径在媒体库根内，或已被登记为交付给渲染层的媒体。
     *
     * @param sourceFilePath 待校验的媒体路径。
     * @throws 路径不在允许范围内时抛出。
     */
    private async assertMediaPathAllowed(sourceFilePath: string): Promise<void> {
        if (!sourceFilePath) {
            throw new Error('媒体路径不能为空');
        }
        const libraryRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.LIBRARY_ROOT);
        if (isPathInsideRoot(libraryRoot, sourceFilePath)) {
            return;
        }
        if (this.mediaPathRegistry.isAllowed(sourceFilePath)) {
            return;
        }
        throw new Error(`媒体路径未授权：${sourceFilePath}`);
    }

    /**
     * 读取并校验媒体时长。
     * @param sourceFilePath 媒体文件绝对路径。
     * @returns 大于零的媒体时长，单位为秒。
     */
    private async readPositiveDuration(sourceFilePath: string): Promise<number> {
        const cached = this.durationCache.get(sourceFilePath);
        if (cached !== undefined) {
            return cached;
        }
        const duration = await this.ffmpegService.duration(sourceFilePath);
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error(`无法读取有效的媒体时长：${sourceFilePath}`);
        }
        this.durationCache.set(sourceFilePath, duration);
        return duration;
    }

    /**
     * 生成稳定的缩略图缓存路径。
     * @param tempDirectory 临时目录绝对路径。
     * @param sourceFilePath 媒体文件绝对路径。
     * @param timestamp 实际截图时间，单位为秒。
     * @param options 缩略图参数。
     * @returns 缩略图文件绝对路径。
     */
    private buildThumbnailPath(
        tempDirectory: string,
        sourceFilePath: string,
        timestamp: number,
        options: ThumbnailOptions,
    ): string {
        const quality = options.quality ?? 'medium';
        const qualitySuffix = quality === 'medium' ? '' : `-${quality}`;
        const widthSuffix = options.width === undefined ? '' : `-w${options.width}`;
        const extension = options.format === 'png' ? '.png' : '.jpg';
        const fileName = `${ObjUtil.hash(sourceFilePath)}-${timestamp}${qualitySuffix}${widthSuffix}${extension}`;
        return path.join(tempDirectory, fileName);
    }

    /**
     * 将截图时间归入 15 秒区间中部，并限制在媒体有效范围内。
     * @param timestamp 请求的截图时间，单位为秒。
     * @param duration 媒体总时长，单位为秒。
     * @returns 实际截图时间，单位为秒。
     */
    private calculateAdjustedTimestamp(timestamp: number | undefined, duration: number): number {
        if (timestamp !== undefined && !Number.isFinite(timestamp)) {
            throw new Error('缩略图时间必须是有限数字');
        }

        const requestedTimestamp = timestamp ?? duration / 2;
        const timestampInRange = Math.min(Math.max(requestedTimestamp, 0), duration);
        const intervalMiddle = Math.floor(timestampInRange / 15) * 15 + 7;
        const latestSafeTimestamp = Math.max(Math.floor(duration) - 1, 0);
        return Math.min(intervalMiddle, latestSafeTimestamp);
    }
}
