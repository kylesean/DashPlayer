import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import MediaUtil from '@/common/utils/MediaUtil';
import StrUtil from '@/common/utils/str-util';

/** 当前播放会话绑定媒体与字幕的状态。 */
export type PlaybackSessionState = {
    /** 当前加载媒体的绝对路径。 */
    videoPath: string | null;
    /** 当前观看历史记录 ID。 */
    videoId: string | null;
    /** 当前加载的字幕文件路径。 */
    subtitlePath: string | null;
    /** 底层媒体元素是否已进入就绪可播状态。 */
    videoLoaded: boolean;
    /** 当前加载字幕对应的内容哈希，用于收藏/生词隔离。 */
    srtHash: string | null;
    /** 增量转录或本地字幕解析会话 ID。 */
    subtitleSessionId: string | null;
    /** 字幕重载令牌；递增时触发播放器按当前字幕路径重建字幕上下文。 */
    subtitleReloadToken: number;
};

/** 当前播放会话状态变更动作。 */
export type PlaybackSessionActions = {
    /** 根据文件路径更新当前视频或字幕路径，并按需重置关联哈希。 */
    updateFile: (file: string) => void;
    /** 标记目标视频路径已完成媒体就绪。 */
    loadedVideo: (file: string) => void;
    /** 清空当前播放会话的全部媒体与字幕绑定状态。 */
    clear: () => void;
    /** 仅清空字幕路径及解析哈希，保留当前视频绑定。 */
    clearSrt: () => void;
    /** 递增重载令牌，用于在路径不变时强制重建字幕（如增量转录结束）。 */
    reloadSubtitles: () => void;
};

/**
 * 管理当前播放器绑定的视频、字幕和字幕哈希等播放会话上下文。
 */
export const usePlaybackSession = create(
    subscribeWithSelector<PlaybackSessionState & PlaybackSessionActions>((set) => ({
        videoPath: null,
        subtitlePath: null,
        videoLoaded: false,
        videoId: null,
        srtHash: null,
        subtitleSessionId: null,
        subtitleReloadToken: 0,
        updateFile: (ph: string) => {
            if (MediaUtil.isMedia(ph)) {
                set({
                    videoPath: ph,
                    videoLoaded: false,
                });
                const fileName = MediaUtil.fileName(ph);
                if (StrUtil.isNotBlank(fileName)) {
                    document.title = fileName;
                }
            }
            if (MediaUtil.isSubtitle(ph)) {
                set((s) => ({
                    subtitlePath: ph,
                    srtHash: s.subtitlePath === ph ? s.srtHash : null,
                    subtitleSessionId: s.subtitlePath === ph ? s.subtitleSessionId : null,
                }));
            }
        },
        loadedVideo: (ph: string) => {
            set((s) => ({
                videoLoaded: s.videoPath === ph,
            }));
        },
        clear: () => {
            document.title = 'Refrain';
            set({
                videoPath: null,
                subtitlePath: null,
                videoLoaded: false,
                videoId: null,
                srtHash: null,
                subtitleSessionId: null,
            });
        },
        clearSrt: () => {
            set({
                subtitlePath: null,
                srtHash: null,
                subtitleSessionId: null,
            });
        },
        reloadSubtitles: () => {
            set((s) => ({ subtitleReloadToken: s.subtitleReloadToken + 1 }));
        },
    })),
);

export default usePlaybackSession;
