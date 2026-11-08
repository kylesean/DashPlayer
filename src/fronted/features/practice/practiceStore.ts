import { create } from 'zustand';
import type { SentencePracticeMode } from '@/common/contracts/sentence-practice';

interface PracticePanelState {
    /** 练习覆盖面板是否可见。 */
    visible: boolean;
    /** 当前练习模式:跟读 / 听写。 */
    mode: SentencePracticeMode;
    setVisible: (visible: boolean) => void;
    setMode: (mode: SentencePracticeMode) => void;
    toggle: () => void;
}

/**
 * 练习面板的全局开关:入口在播放画面胶囊(PracticeModeButton),
 * 面板由播放器 Layout 以覆盖层挂载,与整句学习页互斥打开。
 */
const usePracticePanel = create<PracticePanelState>((set) => ({
    visible: false,
    mode: 'shadowing',
    setVisible: (visible) => set({ visible }),
    setMode: (mode) => set({ mode }),
    toggle: () => set((state) => ({ visible: !state.visible })),
}));

export default usePracticePanel;
