import { beforeEach, describe, expect, it } from 'vitest';
import useChatPanel from '@/fronted/features/chat/chatStore';
import usePracticePanel from '@/fronted/features/practice/practiceStore';
import useLayout from '@/fronted/app/stores/layoutStore';
import {
    exitOverlayView,
    getPlayerViewMode,
    setPlayerViewMode,
    togglePlayerView,
} from '../player-view-controller';
import { hasPlayerViewConflict } from '../player-view-mode';
import { resetBaseViewBeforeOverlay } from '../player-view-sync';

/** 读取三个字段的组合，供冲突断言使用。 */
const readFlags = () => ({
    learningVisible: useChatPanel.getState().learningVisible,
    practiceVisible: usePracticePanel.getState().visible,
    podcastMode: useLayout.getState().podcastMode,
});

describe('播放页视图统一写入点', () => {
    beforeEach(() => {
        // 每个用例从干净的播放画面开始
        useChatPanel.setState({ learningVisible: false });
        usePracticePanel.setState({ visible: false });
        useLayout.setState({ podcastMode: false });
        resetBaseViewBeforeOverlay();
    });

    it('进入任一视图都会关闭另外两个，不出现多层叠加', () => {
        setPlayerViewMode('podcast');
        expect(getPlayerViewMode()).toBe('podcast');

        setPlayerViewMode('practice');
        expect(getPlayerViewMode()).toBe('practice');
        expect(readFlags().podcastMode).toBe(false);
        expect(hasPlayerViewConflict(readFlags())).toBe(false);

        setPlayerViewMode('learning');
        expect(getPlayerViewMode()).toBe('learning');
        expect(readFlags().practiceVisible).toBe(false);
        expect(hasPlayerViewConflict(readFlags())).toBe(false);

        setPlayerViewMode('play');
        expect(readFlags()).toEqual({
            learningVisible: false,
            practiceVisible: false,
            podcastMode: false,
        });
    });

    it('点击同一开关两次回到播放画面', () => {
        expect(togglePlayerView('practice')).toBe('practice');
        expect(togglePlayerView('practice')).toBe('play');
        expect(hasPlayerViewConflict(readFlags())).toBe(false);
    });

    it('已确认缺陷回归：播客模式下打开学习页必须先退出播客', () => {
        setPlayerViewMode('podcast');
        expect(useLayout.getState().podcastMode).toBe(true);

        // 修复前这里只置 learningVisible，播客层仍以 z-30 盖住 z-20 的学习页，
        // 用户看到的是「播放暂停了但页面没变」。
        setPlayerViewMode('learning');

        expect(useChatPanel.getState().learningVisible).toBe(true);
        expect(useLayout.getState().podcastMode).toBe(false);
        expect(hasPlayerViewConflict(readFlags())).toBe(false);
    });

    it('从学习页切到播客时学习页被隐藏，会话不被销毁', () => {
        useChatPanel.setState({
            learningVisible: true,
            hasLearningContext: true,
            chatSessionId: 'session-1',
        });

        setPlayerViewMode('podcast');

        expect(useChatPanel.getState().learningVisible).toBe(false);
        // 只隐藏不销毁：后台解析与对话要继续可用，切回来能接着看
        expect(useChatPanel.getState().chatSessionId).toBe('session-1');
        expect(useChatPanel.getState().hasLearningContext).toBe(true);
    });

    it('非法组合下按覆盖层优先级判定实际视图', () => {
        // 手工制造一个历史遗留的非法组合（模拟旧入口漏配对）
        useChatPanel.setState({ learningVisible: true });
        useLayout.setState({ podcastMode: true });

        expect(getPlayerViewMode()).toBe('podcast');
        expect(hasPlayerViewConflict(readFlags())).toBe(true);
    });

    it('音频文件在播客模式下进学习页，返回时必须回到播客而不是空白舞台', () => {
        // 音频文件没有画面，播客模式是唯一可用的舞台。
        setPlayerViewMode('podcast');

        setPlayerViewMode('learning');
        expect(useLayout.getState().podcastMode).toBe(false);

        exitOverlayView();

        // 修复前这里会落到 play：视频区只剩一个没有画面的 <video>，用户看到黑屏。
        expect(useLayout.getState().podcastMode).toBe(true);
        expect(useChatPanel.getState().learningVisible).toBe(false);
        expect(hasPlayerViewConflict(readFlags())).toBe(false);
    });

    it('普通视频进学习页再返回，回到普通播放画面而不是莫名进入播客', () => {
        setPlayerViewMode('play');

        setPlayerViewMode('learning');
        exitOverlayView();

        expect(readFlags()).toEqual({
            learningVisible: false,
            practiceVisible: false,
            podcastMode: false,
        });
    });

    it('播客模式下进练习面板，退出后同样回到播客', () => {
        setPlayerViewMode('podcast');

        setPlayerViewMode('practice');
        expect(useLayout.getState().podcastMode).toBe(false);
        expect(usePracticePanel.getState().visible).toBe(true);

        exitOverlayView();
        expect(useLayout.getState().podcastMode).toBe(true);
        expect(usePracticePanel.getState().visible).toBe(false);
    });

    it('回归：播客 → 学习 → 跳练习 → 退出练习回到播客，而不是黑屏 play', () => {
        // 修复前的链路：beginOverlayView('learning') 记住 podcast 并收掉播客；
        // 随后跳练习时 beginOverlayView('practice') 无条件重记——此时播客已被收掉，
        // 底层视图被覆写成 'play'，退出练习后音频文件黑屏。
        setPlayerViewMode('podcast');

        setPlayerViewMode('learning');
        expect(useChatPanel.getState().learningVisible).toBe(true);

        // 学习页内跳练习（LearningPage.handleJumpToPractice 的路径）
        setPlayerViewMode('practice');
        expect(usePracticePanel.getState().visible).toBe(true);
        expect(useChatPanel.getState().learningVisible).toBe(false);

        exitOverlayView();
        expect(useLayout.getState().podcastMode).toBe(true);
        expect(usePracticePanel.getState().visible).toBe(false);
        expect(useChatPanel.getState().learningVisible).toBe(false);
    });
});
