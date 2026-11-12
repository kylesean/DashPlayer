import useChatPanel from '@/fronted/features/chat/chatStore';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import {
    beginOverlayView,
    getBaseViewBeforeOverlay,
    resetBaseViewBeforeOverlay,
    syncNonLearningViews,
} from './player-view-sync';
import {
    derivePlayerViewMode,
    resolveViewToggle,
    type PlayerViewMode,
} from './player-view-mode';

/**
 * 读取用户实际看到的视图。
 *
 * @returns 当前实际可见视图。
 */
export function getPlayerViewMode(): PlayerViewMode {
    return derivePlayerViewMode({
        learningVisible: useChatPanel.getState().learningVisible,
        practiceVisible: usePracticePanel.getState().visible,
        podcastMode: useLayout.getState().podcastMode,
    });
}

/**
 * 切换到指定视图，并保证另外两个视图被关闭。
 *
 * 这是播放页视图的唯一写入点。三个字段保留是为了不动既有 UI 的读取方式，
 * 但它们从此不再由各入口各自配对。
 *
 * 学习页的关闭必须走 `hideLearning()`：进入流程进行中的关闭意图需要被记录下来，
 * 否则流程收尾会把学习页重新弹回来。
 *
 * @param mode 目标视图。
 */
export function setPlayerViewMode(mode: PlayerViewMode): void {
    // 学习 ↔ 练习互跳属于「覆盖层叠覆盖层」：此时不得重新记录底层视图，
    // 否则播客记忆会被覆写成 'play'，退出练习后音频文件回到黑屏。
    const alreadyInOverlay = useChatPanel.getState().learningVisible || usePracticePanel.getState().visible;
    if (mode === 'learning') {
        // 由 chatStore 负责真正打开学习页（它还要暂停播放），这里只收掉竞争视图。
        beginOverlayView('learning', alreadyInOverlay);
        if (!useChatPanel.getState().learningVisible) {
            useChatPanel.setState({ learningVisible: true });
        }
        return;
    }

    if (mode === 'practice') {
        // 练习面板同样是覆盖层：记住底层视图，退出时按原样还原。
        beginOverlayView('practice', alreadyInOverlay);
    }

    if (useChatPanel.getState().learningVisible) {
        useChatPanel.getState().hideLearning();
    }
    syncNonLearningViews(mode);
}

/**
 * 点击某个视图开关。
 *
 * 当前已在该视图时表示退出，否则表示进入；进入任一视图都会关闭另外两个。
 *
 * @param target 被点击的视图开关。
 * @returns 切换后的视图。
 */
export function togglePlayerView(target: Exclude<PlayerViewMode, 'play'>): PlayerViewMode {
    const next = resolveViewToggle(getPlayerViewMode(), target);
    setPlayerViewMode(next);
    return next;
}

/**
 * 退出覆盖层，回到它出现之前的底层视图。
 *
 * 音频文件的播客模式是唯一有画面的舞台，直接退回 `play` 会看到黑屏，
 * 因此这里按进入覆盖层时记录的值还原。
 */
export function exitOverlayView(): void {
    const base = getBaseViewBeforeOverlay();
    resetBaseViewBeforeOverlay();
    if (useChatPanel.getState().learningVisible) {
        useChatPanel.getState().hideLearning();
    }
    syncNonLearningViews(base);
}
