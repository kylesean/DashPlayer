import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { StackItem } from '@astryxdesign/core/Stack';
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
        <Dialog
            isOpen={open}
            onOpenChange={onOpenChange}
            purpose="form"
            width={520}
            padding={4}
        >
            <DialogHeader
                title={t('dialog.title')}
                subtitle={t('dialog.description')}
                onOpenChange={onOpenChange}
            />
            <VStack gap={4} width="100%">
                <HStack vAlign="center" gap={2} width="100%">
                    <StackItem size="fill">
                        <TextInput
                            label={t('dialog.placeholder')}
                            isLabelHidden
                            value={url}
                            onChange={(val) => setUrl(val)}
                            placeholder={t('dialog.placeholder')}
                            onEnter={() => void startImport()}
                            type="url"
                            width="100%"
                        />
                    </StackItem>
                    <Button
                        label={t('dialog.start')}
                        variant="primary"
                        icon={<Download className="h-4 w-4" />}
                        isLoading={submitting}
                        isDisabled={!url.trim()}
                        onClick={() => void startImport()}
                    />
                </HStack>
                {taskIds.length > 0 && (
                    <VStack gap={2} isScrollable className="max-h-72">
                        {taskIds.map((taskId) => (
                            <YoutubeImportTaskRow
                                key={taskId}
                                taskId={taskId}
                                onPlay={(result) => void playVideo(result)}
                            />
                        ))}
                    </VStack>
                )}
            </VStack>
        </Dialog>
    );
};

export default YoutubeImportDialog;
