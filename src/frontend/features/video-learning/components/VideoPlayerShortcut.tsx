import React from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useShallow } from 'zustand/react/shallow';
import useSetting from '@/frontend/features/settings/settingsStore';

type Props = {
    onPlayPause: () => void;
    onPrevSentence: () => void;
    onNextSentence: () => void;
    onRepeatSentence: () => void;
    onChangeSingleRepeat: () => void;
    onChangeAutoPause: () => void;
};

/**
 * 规范化快捷键配置，去除空白项。
 */
const processShortcutKeys = (values: string) => values
    .split(',')
    .map((k) => k.replaceAll(' ', ''))
    .filter((k) => k !== '');

/**
 * 视频学习页快捷键注册器：监听设置变化后即时更新绑定。
 */
const VideoPlayerShortcut: React.FC<Props> = ({
    onPlayPause,
    onPrevSentence,
    onNextSentence,
    onRepeatSentence,
    onChangeSingleRepeat,
    onChangeAutoPause,
}) => {
    const shortcuts = useSetting(useShallow((s) => ({
        previousSentence: s.values.get('shortcut.previousSentence') ?? '',
        nextSentence: s.values.get('shortcut.nextSentence') ?? '',
        repeatSentence: s.values.get('shortcut.repeatSentence') ?? '',
        playPause: s.values.get('shortcut.playPause') ?? '',
        repeatSingleSentence: s.values.get('shortcut.repeatSingleSentence') ?? '',
        autoPause: s.values.get('shortcut.autoPause') ?? '',
    })));

    // 从设置中读取绑定的快捷键并注册（默认配置包含方向键与字母键）

    // 自定义快捷键配置（从设置中读取）
    useHotkeys(processShortcutKeys(shortcuts.previousSentence), (e) => {
        e.preventDefault();
        onPrevSentence();
    }, [onPrevSentence]);

    useHotkeys(processShortcutKeys(shortcuts.nextSentence), (e) => {
        e.preventDefault();
        onNextSentence();
    }, [onNextSentence]);

    useHotkeys(processShortcutKeys(shortcuts.repeatSentence), (e) => {
        e.preventDefault();
        onRepeatSentence();
    }, [onRepeatSentence]);

    useHotkeys(processShortcutKeys(shortcuts.playPause), (e) => {
        e.preventDefault();
        onPlayPause();
    }, [onPlayPause]);

    useHotkeys(processShortcutKeys(shortcuts.repeatSingleSentence), (e) => {
        e.preventDefault();
        onChangeSingleRepeat();
    }, [onChangeSingleRepeat]);

    useHotkeys(processShortcutKeys(shortcuts.autoPause), (e) => {
        e.preventDefault();
        onChangeAutoPause();
    }, [onChangeAutoPause]);

    // 返回空fragment，不渲染任何UI
    return <></>;
};

export default VideoPlayerShortcut;
