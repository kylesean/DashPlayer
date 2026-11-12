/**
 * 字幕解析相关的跨进程契约。
 */

/**
 * 字幕解析结论，由后端解析后经 IPC 返回 renderer。
 *
 * `mismatchSuspected` 为 true 表示字幕是靠模糊兜底匹配到的且文件名与视频存疑，
 * 可能是别的视频的字幕，前端据此引导用户重新生成字幕。
 */
export interface SubtitleResolution {
    /** 字幕文件路径；未匹配到时为空字符串。 */
    subtitlePath: string;
    /** 字幕文件名与视频对不上、疑似挂错。 */
    mismatchSuspected: boolean;
    /**
     * 本次解析自动升级前的字幕路径。
     *
     * 仅当「原挂 ASR 轨、同目录存在更优作者轨」时出现。调用方据此回写
     * `dp_watch_history.srt_file`，让数据库记录与实际播放保持一致。
     */
    upgradedFrom?: string;
}
