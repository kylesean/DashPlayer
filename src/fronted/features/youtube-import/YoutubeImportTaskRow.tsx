import React from 'react';
import { useTranslation } from 'react-i18next';
import { CircleX, PlayCircle } from 'lucide-react';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import useDpTaskCenter from '@/fronted/app/stores/dpTaskStore';
import { DpTaskState } from '@/common/contracts/dp-task';
import type { YoutubeImportTaskResult } from '@/common/contracts/youtube-import';
import { youtubeImportApi } from './youtubeImportApi';
import { parsePercent, parseTaskResult } from './youtubeImportTaskUtil';

interface YoutubeImportTaskRowProps {
    /** 任务中心里的后台任务编号。 */
    taskId: number;
    /** 用户点击「去播放」时触发。 */
    onPlay: (result: YoutubeImportTaskResult) => void;
}

/**
 * 单条导入任务的进度行：进度文本、百分比条与终态展示，弹窗与空库主视觉共用。
 */
const YoutubeImportTaskRow = ({ taskId, onPlay }: YoutubeImportTaskRowProps) => {
    const { t } = useTranslation('youtubeImport');
    const task = useDpTaskCenter((state) => state.tasks.get(taskId));
    const taskView = task && task !== 'init' ? task : null;
    const percent = taskView ? parsePercent(taskView.progress) : null;
    const result = taskView ? parseTaskResult(taskView) : null;
    const isDone = taskView?.status === DpTaskState.DONE;
    const isFailed = taskView?.status === DpTaskState.FAILED;
    const isCancelled = taskView?.status === DpTaskState.CANCELLED;
    const isInProgress = taskView?.status === DpTaskState.IN_PROGRESS;

    const statusVariant = isDone
        ? 'success'
        : isFailed
          ? 'error'
          : isInProgress
            ? 'accent'
            : 'neutral';

    const statusLabel = isDone
        ? t('dialog.completed', '已完成')
        : isFailed
          ? t('dialog.failed', '失败')
          : isInProgress
            ? t('dialog.inProgress', '下载中')
            : t('dialog.pending');

    return (
        <Card variant="default" padding={3}>
            <VStack gap={1.5}>
                <HStack vAlign="center" hAlign="between" gap={2}>
                    <HStack vAlign="center" gap={2} className="min-w-0 flex-1">
                        <StatusDot
                            variant={statusVariant}
                            label={statusLabel}
                            isPulsing={isInProgress}
                        />
                        <StackItem size="fill">
                            <Text
                                type="body"
                                weight="medium"
                                maxLines={1}
                            >
                                {taskView?.progress ?? t('dialog.pending')}
                            </Text>
                        </StackItem>
                    </HStack>
                    <HStack vAlign="center" gap={1}>
                        {isDone && result && (
                            <Button
                                variant="ghost"
                                size="sm"
                                label={t('dialog.play')}
                                icon={<PlayCircle className="h-3.5 w-3.5" />}
                                onClick={() => onPlay(result)}
                            />
                        )}
                        {isInProgress && (
                            <Button
                                variant="ghost"
                                size="sm"
                                label={t('dialog.cancel')}
                                icon={<CircleX className="h-3.5 w-3.5" />}
                                onClick={() => void youtubeImportApi.cancel(taskId)}
                            />
                        )}
                    </HStack>
                </HStack>

                {percent !== null && !isDone && !isFailed && !isCancelled && (
                    <ProgressBar
                        label={taskView?.progress ?? t('dialog.pending')}
                        isLabelHidden
                        value={percent}
                        variant="accent"
                    />
                )}

                {isFailed && (
                    <Text
                        type="supporting"
                        maxLines={3}
                        className="text-error"
                    >
                        {taskView?.result ?? t('dialog.failed')}
                    </Text>
                )}

                {isCancelled && (
                    <Text
                        type="supporting"
                        color="secondary"
                    >
                        {t('dialog.cancelled')}
                    </Text>
                )}

                {isDone && result && (
                    <Text
                        type="supporting"
                        color="secondary"
                        maxLines={1}
                    >
                        {result.fileName}
                        {result.attachedSrtFileName ? '' : ` · ${t('dialog.noSubtitle')}`}
                    </Text>
                )}
            </VStack>
        </Card>
    );
};

export default YoutubeImportTaskRow;
