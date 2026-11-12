import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { parseYoutubeVideoId } from '@/common/utils/youtubeUrl';
import useYoutubeImportUi from './youtubeImportUiStore';
import YoutubeImportTaskRow from './YoutubeImportTaskRow';

interface YoutubeImportDialogProps {
    /** 弹窗是否打开。 */
    open: boolean;
    /** 开关弹窗回调。 */
    onOpenChange: (open: boolean) => void;
}

/**
 * YouTube 链接导入弹窗：粘贴地址发起「下载并导入」，实时展示任务进度，
 * 任务结束后由任务行显式「去播放」进入播放页（不做自动跳转）。
 */
const YoutubeImportDialog = ({ open, onOpenChange }: YoutubeImportDialogProps) => {
    const { t } = useTranslation('youtubeImport');
    const url = useYoutubeImportUi((s) => s.url);
    const setUrl = useYoutubeImportUi((s) => s.setUrl);
    const submitting = useYoutubeImportUi((s) => s.submitting);
    const tasks = useYoutubeImportUi((s) => s.tasks);
    const startImport = useYoutubeImportUi((s) => s.startImport);

    const videoId = parseYoutubeVideoId(url);
    const isInvalid = url.trim().length > 0 && !videoId;
    const canSubmit = Boolean(videoId) && !submitting;

    return (
        <Dialog
            isOpen={open}
            onOpenChange={onOpenChange}
            purpose="form"
            width={480}
            padding={4}
        >
            <VStack gap={4} width="100%">
                <DialogHeader
                    title={t('dialog.title')}
                    subtitle={t('dialog.description')}
                    onOpenChange={onOpenChange}
                    hasDivider={false}
                />
                <VStack gap={3} width="100%">
                    <TextInput
                        label={t('dialog.urlLabel')}
                        value={url}
                        onChange={(val) => setUrl(val)}
                        placeholder={t('dialog.placeholder')}
                        onEnter={() => {
                            if (canSubmit) void startImport();
                        }}
                        type="url"
                        width="100%"
                        hasClear
                        hasAutoFocus
                        status={isInvalid
                            ? { type: 'error', message: t('dialog.invalidUrl') }
                            : undefined}
                    />
                    <HStack hAlign="end">
                        <Button
                            label={t('dialog.start')}
                            variant="primary"
                            icon={<Icon icon={Download as unknown as IconType} size="sm" />}
                            isLoading={submitting}
                            isDisabled={!canSubmit}
                            onClick={() => void startImport()}
                        />
                    </HStack>
                </VStack>
                {tasks.length > 0 && (
                    <VStack gap={2} isScrollable className="max-h-72">
                        {tasks.map((entry) => (
                            <YoutubeImportTaskRow key={entry.taskId} entry={entry} />
                        ))}
                    </VStack>
                )}
            </VStack>
        </Dialog>
    );
};

export default YoutubeImportDialog;
