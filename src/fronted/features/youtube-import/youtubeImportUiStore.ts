import { create } from 'zustand';

/**
 * YouTube 导入弹窗的全局开关。
 *
 * 入口按钮分布在首页头部与侧栏等多处，弹窗本身以单例挂在 HashRouter 根部
 * （YoutubeImportDialogHost）；各入口只翻转这里的开关，避免多实例弹窗并存。
 */
type YoutubeImportUiState = {
    /** 导入弹窗是否打开。 */
    open: boolean;
    setOpen: (open: boolean) => void;
};

const useYoutubeImportUi = create<YoutubeImportUiState>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));

export default useYoutubeImportUi;
