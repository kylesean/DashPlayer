import usePracticePanel from '@/fronted/features/practice/practiceStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import { viewModeFlags, type PlayerViewMode } from './player-view-mode';

/**
 * 覆盖层（学习/练习）出现之前的底层视图。
 *
 * 为什么需要它：播客模式对音频文件是**唯一可用的舞台**——关掉播客后视频区
 * 只剩一个没有画面的 `<video>`。用户「播客 → 学习 → 返回」时如果直接落到
 * `play`，音频文件会看到一块黑屏，这是实打实的回归。
 *
 * 因此学习/练习只临时收起播客，退出覆盖层时按这里记录的值还原。
 * 放在本模块而不是控制器里，是为了让 `chatStore` 也能记录，同时不产生依赖环。
 */
let baseViewBeforeOverlay: 'play' | 'podcast' = 'play';

/**
 * 记录当前底层视图，供退出覆盖层时还原。
 *
 * @param mode 覆盖层出现前的实际视图。
 */
export function rememberBaseView(mode: PlayerViewMode): void {
    if (mode === 'podcast' || mode === 'play') {
        baseViewBeforeOverlay = mode;
    }
}

/**
 * 读取退出覆盖层后应回到的底层视图。
 *
 * @returns `podcast` 表示原来在播客模式，`play` 表示普通播放画面。
 */
export function getBaseViewBeforeOverlay(): 'play' | 'podcast' {
    return baseViewBeforeOverlay;
}

/**
 * 清空底层视图记忆（回到普通播放画面后调用）。
 */
export function resetBaseViewBeforeOverlay(): void {
    baseViewBeforeOverlay = 'play';
}

/**
 * 按目标视图同步「练习面板」与「播客模式」两个字段。
 *
 * 单独拆出来是为了打断依赖环：`chatStore` 需要在进入学习页时关闭竞争视图，
 * 但 `chatStore` 不能被视图控制器反向依赖。这里只碰练习与播客两个 store，
 * 不碰 `chatStore`，因此 `chatStore → 本模块 → practiceStore/layoutStore`
 * 是一条单向依赖。
 *
 * @param mode 目标视图。
 */
export function syncNonLearningViews(mode: PlayerViewMode): void {
    const flags = viewModeFlags(mode);
    if (usePracticePanel.getState().visible !== flags.practiceVisible) {
        usePracticePanel.getState().setVisible(flags.practiceVisible);
    }
    if (useLayout.getState().podcastMode !== flags.podcastMode) {
        useLayout.getState().setPodcastMode(flags.podcastMode);
    }
}

/**
 * 进入覆盖层（学习 / 练习）前记录底层视图，并收掉竞争视图。
 *
 * `chatStore` 进入学习页时调用：它自己负责暂停播放与落 `learningVisible`，
 * 这里只处理「别的视图必须让路」以及「退出时要回到哪」。
 *
 * @param mode 即将进入的覆盖层视图。
 */
export function beginOverlayView(mode: 'learning' | 'practice'): void {
    rememberBaseView(readCurrentBaseView());
    syncNonLearningViews(mode);
}

/**
 * 读取当前底层视图：播客为真就是播客，否则视为普通播放画面。
 *
 * 只看播客字段，不看学习/练习——覆盖层本身就是「临时借用舞台」，
 * 不改变底层是什么。
 *
 * @returns 当前底层视图。
 */
function readCurrentBaseView(): 'play' | 'podcast' {
    return useLayout.getState().podcastMode ? 'podcast' : 'play';
}
