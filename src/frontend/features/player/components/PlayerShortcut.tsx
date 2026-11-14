import { useShallow } from 'zustand/react/shallow';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'react-hot-toast';

import useSetting from '@/frontend/features/settings/settingsStore';
import { useSubtitleScrollState } from '@/frontend/features/player/hooks/useSubtitleScroll';
import useChatPanel from '@/frontend/features/chat/chatStore';
import usePracticePanel from '@/frontend/features/practice/practiceStore';
import { playerActions } from '@/frontend/features/player/components/PlayerActions';
import { usePlayer } from '@/frontend/features/player/playerStore';
import { usePlayerUi } from '@/frontend/features/player/playerUiStore';
import { exitOverlayView } from '@/frontend/features/player/lib/player-view-controller';
import useLayout from '@/frontend/app/stores/layoutStore';

/**
 * 规范化快捷键配置字符串，去除空白项。
 *
 * @param values 逗号分隔的快捷键配置字符串。
 * @returns 规范化的快捷键数组。
 */
const process = (values: string) => values
    .split(',')
    .map((k) => k.replaceAll(' ', ''))
    .filter((k) => k !== '');

/**
 * 注册播放器页快捷键，并在快捷键配置变化后即时重绑。
 *
 * 学习页打开期间或跟读录音进行中，全部播放类快捷键停用（enabled: false），
 * 避免学习时误触改变播放状态、录音中被开播/切句导致评分挂错句与原声混录；
 * 只有开关学习页的快捷键保持可用，否则用户无法用键盘退出学习页。
 */
export default function PlayerShortCut() {
    const {
        changeShowEn,
        changeShowCn,
        changeShowEnCn,
        changeShowWordLevel
    } = usePlayerUi(
        useShallow((s) => ({
            changeShowEn: s.changeShowEn,
            changeShowCn: s.changeShowCn,
            changeShowEnCn: s.changeShowEnCn,
            changeShowWordLevel: s.changeShowWordLevel
        }))
    );

    const { onUserFinishScrolling, scrollState } = useSubtitleScrollState(
        useShallow((s) => ({
            onUserFinishScrolling: s.onUserFinishScrolling,
            scrollState: s.scrollState,
        }))
    );

    const shortcuts = useSetting(useShallow((s) => ({
        previousSentence: s.values.get('shortcut.previousSentence') ?? '',
        nextSentence: s.values.get('shortcut.nextSentence') ?? '',
        repeatSentence: s.values.get('shortcut.repeatSentence') ?? '',
        playPause: s.values.get('shortcut.playPause') ?? '',
        repeatSingleSentence: s.values.get('shortcut.repeatSingleSentence') ?? '',
        autoPause: s.values.get('shortcut.autoPause') ?? '',
        toggleEnglishDisplay: s.values.get('shortcut.toggleEnglishDisplay') ?? '',
        toggleChineseDisplay: s.values.get('shortcut.toggleChineseDisplay') ?? '',
        toggleBilingualDisplay: s.values.get('shortcut.toggleBilingualDisplay') ?? '',
        adjustBeginMinus: s.values.get('shortcut.adjustBeginMinus') ?? '',
        adjustBeginPlus: s.values.get('shortcut.adjustBeginPlus') ?? '',
        adjustEndMinus: s.values.get('shortcut.adjustEndMinus') ?? '',
        adjustEndPlus: s.values.get('shortcut.adjustEndPlus') ?? '',
        clearAdjust: s.values.get('shortcut.clearAdjust') ?? '',
        toggleWordLevelDisplay: s.values.get('shortcut.toggleWordLevelDisplay') ?? '',
        nextPlaybackRate: s.values.get('shortcut.nextPlaybackRate') ?? '',
        aiChat: s.values.get('shortcut.aiChat') ?? '',
        volumeUp: s.values.get('shortcut.volumeUp') ?? '',
        volumeDown: s.values.get('shortcut.volumeDown') ?? '',
        seekBackward: s.values.get('shortcut.seekBackward') ?? '',
        seekForward: s.values.get('shortcut.seekForward') ?? '',
        openControlPanel: s.values.get('shortcut.openControlPanel') ?? '',
    })));

    // 模式开关的写入统一走 PlayerActions，此处只订阅展示用的值
    const singleRepeat = usePlayer((s) => s.singleRepeat);
    const autoPause = usePlayer((s) => s.autoPause);
    const learningVisible = useChatPanel((s) => s.learningVisible);
    const practiceVisible = usePracticePanel((s) => s.visible);
    // 跟读录音进行中（含学习页内的复述录音）全部播放类快捷键停用：
    // 开播/切句会改变播放状态或重挂录音视图，导致评分挂错句与原声混录。
    const practiceRecording = usePracticePanel((s) => s.recorderPhase === 'recording');
    const playbackKeysEnabled = !learningVisible && !practiceVisible && !practiceRecording;
    const showSideBar = useLayout((s) => s.showSideBar);
    const changeSideBar = useLayout((s) => s.changeSideBar);

    useHotkeys(process(shortcuts.openControlPanel), () => {
        changeSideBar(!showSideBar);
    }, [changeSideBar, showSideBar]);

    const toggleSingleRepeat = () => {
        playerActions.setSingleRepeat(!singleRepeat);
    };
    const toggleAutoPause = () => {
        playerActions.setAutoPause(!autoPause);
    };

    useHotkeys(process(shortcuts.previousSentence), (e) => {
        e.preventDefault();
        playerActions.prevSentence();
        if (scrollState === 'USER_BROWSING') {
            onUserFinishScrolling();
        }
    }, { enabled: playbackKeysEnabled }, [onUserFinishScrolling, scrollState]);

    useHotkeys(process(shortcuts.nextSentence), (e) => {
        e.preventDefault();
        playerActions.nextSentence();
        if (scrollState === 'USER_BROWSING') {
            onUserFinishScrolling();
        }
    }, { enabled: playbackKeysEnabled }, [onUserFinishScrolling, scrollState]);

    useHotkeys(process(shortcuts.repeatSentence), (e) => {
        e.preventDefault();
        playerActions.repeatCurrent({ loop: false });
        if (scrollState === 'USER_BROWSING') {
            onUserFinishScrolling();
        }
    }, { enabled: playbackKeysEnabled }, [onUserFinishScrolling, scrollState]);

    useHotkeys(process(shortcuts.playPause), (e) => {
        e.preventDefault();
        playerActions.togglePlay();
    }, { enabled: playbackKeysEnabled });

    useHotkeys(process(shortcuts.repeatSingleSentence), toggleSingleRepeat, { enabled: playbackKeysEnabled }, [toggleSingleRepeat]);
    useHotkeys(process(shortcuts.autoPause), toggleAutoPause, { enabled: playbackKeysEnabled }, [toggleAutoPause]);
    useHotkeys(process(shortcuts.toggleEnglishDisplay), changeShowEn, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.toggleChineseDisplay), changeShowCn, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.toggleBilingualDisplay), changeShowEnCn, { enabled: playbackKeysEnabled });

    useHotkeys(process(shortcuts.adjustBeginMinus), () => {
        playerActions.adjustCurrentBegin(-0.2);
    }, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.adjustBeginPlus), () => {
        playerActions.adjustCurrentBegin(0.2);
    }, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.adjustEndMinus), () => {
        playerActions.adjustCurrentEnd(-0.2);
    }, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.adjustEndPlus), () => {
        playerActions.adjustCurrentEnd(0.2);
    }, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.clearAdjust), () => {
        void playerActions.clearAdjust();
    }, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.toggleWordLevelDisplay), changeShowWordLevel, { enabled: playbackKeysEnabled });
    useHotkeys(process(shortcuts.nextPlaybackRate), playerActions.cyclePlaybackRate.bind(playerActions), { enabled: playbackKeysEnabled });

    useHotkeys(process(shortcuts.volumeUp), (e) => {
        e.preventDefault();
        const current = usePlayer.getState().volume;
        playerActions.setVolume(Math.min(1, Math.round((current + 0.1) * 10) / 10));
    }, { enabled: playbackKeysEnabled });

    useHotkeys(process(shortcuts.volumeDown), (e) => {
        e.preventDefault();
        const current = usePlayer.getState().volume;
        playerActions.setVolume(Math.max(0, Math.round((current - 0.1) * 10) / 10));
    }, { enabled: playbackKeysEnabled });

    useHotkeys(process(shortcuts.seekBackward), (e) => {
        e.preventDefault();
        const currentTime = usePlayer.getState().internal.exactPlayTime;
        playerActions.seekTo({ time: Math.max(0, currentTime - 5) });
    }, { enabled: playbackKeysEnabled });

    useHotkeys(process(shortcuts.seekForward), (e) => {
        e.preventDefault();
        const currentTime = usePlayer.getState().internal.exactPlayTime;
        const duration = usePlayer.getState().duration;
        playerActions.seekTo({ time: Math.min(duration, currentTime + 5) });
    }, { enabled: playbackKeysEnabled });

    useHotkeys(process(shortcuts.aiChat), () => {
        // 同一个快捷键开关学习页：进入时学习页会自行暂停播放，返回时不动播放状态。
        // 已打开时用 exitOverlayView 退出：音频文件原来在播客模式，必须回到播客，
        // 直接 hideLearning 会掉进没有画面的普通舞台。
        if (useChatPanel.getState().learningVisible) {
            exitOverlayView();
            return;
        }
        // 视图互斥（含播客模式）由 chatStore 的进入路径统一收口，
        // 否则播客模式下按这个键会「暂停了播放但页面被播客层盖住」。
        useChatPanel.getState().createFromCurrent().catch((error) => {
            toast.error(error instanceof Error ? error.message : String(error));
        });
    }, []);

    return <></>;
}
