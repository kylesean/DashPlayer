// ".mp4,.webm,.wav,.srt"

import StrUtil from '@/common/utils/str-util';

export const SupportedVideoFormats = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
export const UnsupportedVideoFormats = ['.mkv'];
export const SupportedAudioFormats = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.wma', '.aac'];
export const SupportedSubtitleFormats = ['.srt', '.vtt', '.ass'];
export const AllFormats = [...SupportedVideoFormats, ...UnsupportedVideoFormats, ...SupportedAudioFormats, ...SupportedSubtitleFormats];
export const SupportedFormats = [...SupportedVideoFormats, ...SupportedAudioFormats, ...SupportedSubtitleFormats];
/** 全部媒体文件（视频 + 音频，不含字幕），与 {@link MediaUtil.isMedia} 的判定范围一致。 */
export const MediaFormats = [...SupportedVideoFormats, ...UnsupportedVideoFormats, ...SupportedAudioFormats];
export default class MediaUtil {
    public static isSrt(path: string): boolean {
        if (StrUtil.isBlank(path)) {
            return false;
        }
        return path.endsWith('.srt');
    }

    public static isVtt(path: string): boolean {
        if (StrUtil.isBlank(path)) {
            return false;
        }
        return path.endsWith('.vtt');
    }

    public static isAss(path: string): boolean {
        if (StrUtil.isBlank(path)) {
            return false;
        }
        return path.endsWith('.ass');
    }

    public static isSubtitle(path: string): boolean {
        return MediaUtil.isSrt(path) || MediaUtil.isVtt(path) || MediaUtil.isAss(path);
    }

    public static supported(path: string): boolean {
        if (StrUtil.isBlank(path)) {
            return false;
        }
        return SupportedFormats.some(f => path.endsWith(f));
    }

    public static isVideo(path: string): boolean {
        if (StrUtil.isBlank(path)) {
            return false;
        }
        // SupportedVideoFormats and UnsupportedVideoFormats
        return [...SupportedVideoFormats, ...UnsupportedVideoFormats].some(f => path.endsWith(f));
    }

    public static isAudio(path: string): boolean {
        if (StrUtil.isBlank(path)) {
            return false;
        }
        return SupportedAudioFormats.some(f => path.endsWith(f));
    }

    public static isMedia(path: string): boolean {
        return MediaUtil.isVideo(path) || MediaUtil.isAudio(path);
    }

    public static fileName(path: string): string {
        if (StrUtil.isBlank(path)) {
            return '';
        }
        const fileSeparator = path.lastIndexOf('/') > 0 ? '/' : '\\';
        return path.substring(path.lastIndexOf(fileSeparator) + 1);
    }

    /**
     * 将磁盘媒体文件名格式化为面向用户的展示标题：
     * 剥离常见媒体/字幕扩展名，以及 yt-dlp 落盘时附加的 ` [11位YouTubeID]` 后缀。
     */
    public static formatDisplayTitle(fileName: string): string {
        if (StrUtil.isBlank(fileName)) {
            return '';
        }
        const lower = fileName.toLowerCase();
        const matchedExt = AllFormats.find((ext) => lower.endsWith(ext));
        const withoutExt = matchedExt ? fileName.slice(0, -matchedExt.length) : fileName;
        const withoutYtId = withoutExt.replace(/\s+\[[A-Za-z0-9_-]{11}\]$/u, '');
        return withoutYtId.length > 0 ? withoutYtId : withoutExt;
    }
}
