import useLayout from '@/fronted/app/stores/layoutStore';
import { playerApi } from '@/fronted/features/player/playerApi';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { swrMutate, SWR_KEY } from '@/fronted/lib/swr-util';

/**
 * 切换播客模式，并把“这个视频用哪种模式”写进观看记录。
 *
 * 播客模式是覆盖整个播放区的视图，进入后视频控制条与字幕学习台都会隐藏；
 * 因此所有切换入口（设置弹层、播客控制条）必须走同一个函数，保证
 * “当前视图”和“下次打开这个视频的模式”一起改，不会出现退出后又被
 * 自动切回播客的情况。
 *
 * @param enabled 是否进入播客模式。
 */
export function setPodcastModeForCurrentVideo(enabled: boolean): void {
    useLayout.getState().setPodcastMode(enabled);
    const videoId = usePlaybackSession.getState().videoId;
    if (!videoId) {
        return;
    }
    void playerApi.setPodcastModePreference(videoId, enabled);
    void swrMutate(SWR_KEY.PLAYER_P);
}
