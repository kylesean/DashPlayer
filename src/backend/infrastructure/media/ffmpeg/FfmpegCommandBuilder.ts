import TimeUtil from '@/common/utils/TimeUtil';
import type {
    ConvertToWavArgs,
    CreateThumbnailArgs,
    ExtractSubtitleCommandArgs,
    TrimVideoArgs,
} from '@/backend/services/gateways/media/FfmpegGateway';

/**
 * FFmpeg 命令构建器接口。
 *
 * 参数类型统一从网关契约（FfmpegGateway.ts）导入，保证业务层、网关与构建器看到同一份定义。
 */
export interface FfmpegCommandBuilder {

    /**
     * 构建视频裁剪命令参数。
     */
    buildTrimVideo(args: TrimVideoArgs): string[];

    /**
     * 构建缩略图命令参数。
     */
    buildThumbnail(args: CreateThumbnailArgs): string[];

    /**
     * 构建字幕提取命令参数；字幕流必须由网关探测选定后传入，避免命中图形字幕或多流。
     */
    buildExtractSubtitle(args: ExtractSubtitleCommandArgs): string[];

    
    /**
     * 构建音频转 WAV 命令参数。
     */
    buildConvertToWav(args: ConvertToWavArgs): string[];

}

/**
 * 默认 FFmpeg 命令构建实现。
 */
export class DefaultFfmpegCommandBuilder implements FfmpegCommandBuilder {
    /**
     * 构建视频裁剪命令参数。
     */
    public buildTrimVideo(args: TrimVideoArgs): string[] {
        this.assertRange(args.startSecond, args.endSecond, '视频裁剪');

        const duration = args.endSecond - args.startSecond;
        const videoCodec = args.videoCodec ?? 'libx264';
        const audioCodec = args.audioCodec ?? 'aac';
        const crf = args.crf ?? 23;

        const result: string[] = [
            '-y',
            '-ss', TimeUtil.secondToTimeStrWithMs(args.startSecond),
            '-i', args.inputFile,
            '-t', `${duration}`,
            '-c:v', videoCodec,
            // 强制 8bit yuv420p：源为 10bit 时 libx264/x265 会离出 High10/Main10，浏览器普遍无法播放。
            '-pix_fmt', 'yuv420p',
        ];

        if (args.videoPreset) {
            result.push('-preset', args.videoPreset);
        }

        result.push('-crf', `${crf}`);
        result.push('-c:a', audioCodec);

        if (typeof args.audioChannels === 'number' && args.audioChannels > 0) {
            result.push('-ac', `${Math.floor(args.audioChannels)}`);
        }

        if (args.audioBitrate) {
            result.push('-b:a', args.audioBitrate);
        }

        if (typeof args.outputWidth === 'number' && args.outputWidth > 0) {
            // -2 保证高度取偶：libx264/x265 编码 yuv420p 要求宽高均为偶数，奇数高度会直接报错。
            result.push('-vf', `scale=${Math.floor(args.outputWidth)}:-2`);
        }

        result.push(args.outputFile);
        return result;
    }

    /**
     * 构建缩略图命令参数。
     */
    public buildThumbnail(args: CreateThumbnailArgs): string[] {
        this.assertNonNegative(args.timeSecond, '缩略图时间点');

        const format = args.format ?? 'jpg';
        const result: string[] = [
            '-y',
            '-ss', TimeUtil.secondToTimeStrWithMs(args.timeSecond),
            '-i', args.inputFile,
            '-frames:v', '1',
        ];

        if (typeof args.width === 'number' && args.width > 0) {
            result.push('-vf', `scale=${Math.floor(args.width)}:-1`);
        }

        if (format === 'jpg') {
            const qscale = args.jpgQScale ?? 4;
            result.push('-q:v', `${qscale}`);
        }

        result.push('-f', 'image2', args.outputFile);
        return result;
    }

    /**
     * 构建字幕提取命令参数；只映射探测选定的单条字幕流，避免多流写单文件报错。
     *
     * 显式指定输出封装格式：产物先写到不带扩展名的临时文件，无法由扩展名推断格式。
     */
    public buildExtractSubtitle(args: ExtractSubtitleCommandArgs): string[] {
        return [
            '-y',
            '-i', args.inputFile,
            '-map', `0:${args.streamIndex}`,
            '-c:s', 'srt',
            '-f', 'srt',
            args.outputFile,
        ];
    }

    
    /**
     * 构建音频转 WAV 命令参数。
     */
    public buildConvertToWav(args: ConvertToWavArgs): string[] {
        const sampleRate = args.sampleRate ?? 16000;
        const channels = args.channels ?? 1;

        const result = ['-y'];
        if (args.startSecond !== undefined || args.endSecond !== undefined) {
            if (args.startSecond === undefined || args.endSecond === undefined) {
                throw new Error('WAV 裁剪必须同时提供起止时间');
            }
            this.assertRange(args.startSecond, args.endSecond, 'WAV 裁剪');
            result.push('-ss', TimeUtil.secondToTimeStrWithMs(args.startSecond));
        }
        result.push('-i', args.inputFile);
        if (args.startSecond !== undefined && args.endSecond !== undefined) {
            result.push('-t', `${args.endSecond - args.startSecond}`);
        }
        result.push(
            '-vn',
            '-ar', `${sampleRate}`,
            '-ac', `${channels}`,
            '-c:a', 'pcm_s16le',
            '-f', 'wav',
            args.outputFile,
        );
        return result;
    }

    /**
     * 校验时间区间是否合法。
     */
    private assertRange(startSecond: number, endSecond: number, label: string): void {
        this.assertNonNegative(startSecond, `${label}起始时间`);
        this.assertNonNegative(endSecond, `${label}结束时间`);
        if (endSecond <= startSecond) {
            throw new Error(`${label}结束时间必须大于起始时间`);
        }
    }

    /**
     * 校验时间值为非负数。
     */
    private assertNonNegative(value: number, label: string): void {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`${label}必须是非负数字`);
        }
    }
}