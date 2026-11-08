import { create } from 'zustand';
import type { SentencePracticeMode } from '@/common/contracts/sentence-practice';

interface PracticePanelState {
    /** 练习覆盖面板是否可见。 */
    visible: boolean;
    /** 当前练习模式:跟读 / 听写。 */
    mode: SentencePracticeMode;
    /** 跟读录音是否进行中。快捷键层据此停用播放类快捷键,避免录音中被开播/切句导致评分挂错句。 */
    recording: boolean;
    setVisible: (visible: boolean) => void;
    setMode: (mode: SentencePracticeMode) => void;
    setRecording: (recording: boolean) => void;
    toggle: () => void;
}

/**
 * 练习面板的全局开关:入口在播放画面胶囊(PracticeModeButton),
 * 面板由播放器 Layout 以覆盖层挂载,与整句学习页互斥打开。
 */
const usePracticePanel = create<PracticePanelState>((set) => ({
    visible: false,
    mode: 'shadowing',
    recording: false,
    setVisible: (visible) => set({ visible }),
    setMode: (mode) => set({ mode }),
    setRecording: (recording) => set({ recording }),
    toggle: () => set((state) => ({ visible: !state.visible })),
}));

export default usePracticePanel;
