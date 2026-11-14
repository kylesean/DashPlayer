import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fileBrowserApi } from '@/frontend/features/file-browser/fileBrowserApi';
import useYoutubeImportUi from './youtubeImportUiStore';
import YoutubeImportDialog from './YoutubeImportDialog';

/**
 * 全局单例导入弹窗：挂在 HashRouter 根部，任何入口（首页按钮、侧栏项）
 * 只翻转 youtubeImportUiStore 的开关，弹窗实例全局只有这一份。
 *
 * 「去播放」也统一在这里执行：任务行只写 playTarget，避免弹窗与 Hero
 * 各自持有一套导航逻辑。
 */
const YoutubeImportDialogHost = () => {
    const navigate = useNavigate();
    const open = useYoutubeImportUi((s) => s.open);
    const setOpen = useYoutubeImportUi((s) => s.setOpen);
    const playTarget = useYoutubeImportUi((s) => s.playTarget);
    const consumePlay = useYoutubeImportUi((s) => s.consumePlay);

    useEffect(() => {
        if (!playTarget) return;
        consumePlay();
        setOpen(false);
        void fileBrowserApi.changeWindowSize('player').then(() => {
            navigate(`/player/${playTarget.videoId}`);
        });
    }, [consumePlay, navigate, playTarget, setOpen]);

    return <YoutubeImportDialog open={open} onOpenChange={setOpen} />;
};

export default YoutubeImportDialogHost;
