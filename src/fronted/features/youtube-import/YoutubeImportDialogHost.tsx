import useYoutubeImportUi from './youtubeImportUiStore';
import YoutubeImportDialog from './YoutubeImportDialog';

/**
 * 全局单例导入弹窗：挂在 HashRouter 根部，任何入口（首页按钮、侧栏项）
 * 只翻转 youtubeImportUiStore 的开关，弹窗实例全局只有这一份。
 */
const YoutubeImportDialogHost = () => {
    const open = useYoutubeImportUi((s) => s.open);
    const setOpen = useYoutubeImportUi((s) => s.setOpen);
    return <YoutubeImportDialog open={open} onOpenChange={setOpen} />;
};

export default YoutubeImportDialogHost;
