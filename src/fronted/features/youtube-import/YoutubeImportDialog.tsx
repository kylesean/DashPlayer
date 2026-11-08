import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/fronted/components/ui/dialog';
import { Button } from '@/fronted/components/ui/button';
import { Input } from '@/fronted/components/ui/input';
import useYoutubeImportTasks from './useYoutubeImportTasks';
import YoutubeImportTaskRow from './YoutubeImportTaskRow';

interface YoutubeImportDialogProps {
    /** 弹窗是否打开。 */
    open: boolean;
    /** 开关弹窗回调。 */
    onOpenChange: (open: boolean) => void;
}

/**
 * YouTube 链接导入弹窗：粘贴地址发起下载，实时展示任务进度，
 * 登记的全部任务结束后自动跳转最近一个成功入库的视频。
 */
const YoutubeImportDialog = ({ open, onOpenChange }: YoutubeImportDialogProps) => {
    const { t } = useTranslation('youtubeImport');
    const { url, setUrl, submitting, taskIds, startImport, playVideo } = useYoutubeImportTasks({
        // 弹窗关闭后任务才结束（或用户已手动跳转）时不再自动跳转。
        canAutoJump: () => open,
        onBeforeJump: () => onOpenChange(false),
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('dialog.title')}</DialogTitle>
                    <DialogDescription>{t('dialog.description')}</DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2">
                    <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder={t('dialog.placeholder')}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                void startImport();
                            }
                        }}
                    />
                    <Button onClick={() => void startImport()} disabled={submitting || !url.trim()} className="shrink-0">
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {t('dialog.start')}
                    </Button>
                </div>
                {taskIds.length > 0 && (
                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                        {taskIds.map((taskId) => (
                            <YoutubeImportTaskRow
                                key={taskId}
                                taskId={taskId}
                                onPlay={(result) => void playVideo(result)}
                            />
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default YoutubeImportDialog;
