import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleX, Copy, PlayCircle, RotateCcw } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { showNotification } from '@/fronted/components/shared/toasts/notification';
import useDpTaskCenter from '@/fronted/app/stores/dpTaskStore';
import { DpTaskState } from '@/common/contracts/dp-task';
import { youtubeImportApi } from './youtubeImportApi';
import { parseTaskResult } from './youtubeImportTaskUtil';
import useYoutubeImportUi, { type YoutubeImportTaskEntry } from './youtubeImportUiStore';

interface YoutubeImportTaskRowProps {
    /** 共享 store 中的任务条目：编号、原始 URL 与解析出的 videoId。 */
    entry: YoutubeImportTaskEntry;
}

/** 去掉协议前缀，任务行用短 URL 作为视频身份。 */
const displayIdentity = (url: string): string => url.replace(/^https?:\/\//, '');

/**
 * 单条导入任务的进度行：视频身份、结构化阶段进度、终态操作与失败详情。
 *
 * 进度文案只读 `progressMeta`（阶段 code + 百分比），不再展示后端原始文本，
 * 保证中英文界面一致。
 */
const YoutubeImportTaskRow = ({ entry }: YoutubeImportTaskRowProps) => {
    const { t } = useTranslation('youtubeImport');
    const task = useDpTaskCenter((state) => state.tasks.get(entry.taskId));
    const requestPlay = useYoutubeImportUi((state) => state.requestPlay);
    const retryTask = useYoutubeImportUi((state) => state.retryTask);
    const [cancelling, setCancelling] = useState(false);
    const [retrying, setRetrying] = useState(false);

    const taskView = task && task !== 'init' ? task : null;
    const result = taskView ? parseTaskResult(taskView) : null;
    const isDone = taskView?.status === DpTaskState.DONE;
    const isFailed = taskView?.status === DpTaskState.FAILED;
    const isCancelled = taskView?.status === DpTaskState.CANCELLED;
    const isInProgress = taskView?.status === DpTaskState.IN_PROGRESS;
    const isPending = !taskView || taskView.status === DpTaskState.INIT;
    const canCancel = isPending || isInProgress;

    const stageCode = taskView?.progressMeta?.code;
    const percent = taskView?.progressMeta?.percent ?? null;

    const statusVariant = isDone
        ? 'success'
        : isFailed
          ? 'error'
          : isInProgress
            ? 'accent'
            : 'neutral';

    const statusLabel = isDone
        ? t('dialog.completed')
        : isFailed
          ? t('dialog.failed')
          : isCancelled
            ? t('dialog.cancelled')
            : isInProgress
              ? t('dialog.inProgress')
              : t('dialog.pending');

    const stageLabel = (() => {
        switch (stageCode) {
            case 'queued':
                return t('stages.queued');
            case 'preparing':
                return t('stages.preparing');
            case 'binaryDownload':
                return t('stages.binaryDownload');
            case 'connecting':
                return t('stages.connecting');
            case 'downloading':
                return t('stages.downloading');
            case 'finalizing':
                return t('stages.finalizing');
            case 'reusing':
                return t('stages.reusing');
            default:
                return isInProgress ? t('dialog.processing') : t('dialog.pending');
        }
    })();

    const failureReason = taskView?.progressMeta?.params?.reason;

    const errorSummary = (() => {
        switch (failureReason) {
            case 'rateLimited':
                return t('errors.rateLimited');
            case 'needCookies':
                return t('errors.needCookies');
            case 'regionBlocked':
                return t('errors.regionBlocked');
            case 'unavailable':
                return t('errors.unavailable');
            case 'diskFull':
                return t('errors.diskFull');
            case 'ffmpegMissing':
                return t('errors.ffmpegMissing');
            default:
                return t('errors.generic');
        }
    })();

    const cancel = async () => {
        if (cancelling) return;
        setCancelling(true);
        try {
            const response = await youtubeImportApi.cancel(entry.taskId);
            if (!response.cancelled) {
                showNotification({ variant: 'warning', message: t('dialog.cancelUnavailable') });
            }
        } catch (error) {
            showNotification({
                variant: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setCancelling(false);
        }
    };

    const copyUrl = async () => {
        try {
            await navigator.clipboard.writeText(entry.url);
            showNotification({ variant: 'success', message: t('dialog.copied') });
        } catch {
            showNotification({ variant: 'error', message: t('dialog.copyFailed') });
        }
    };

    const retry = async () => {
        if (retrying) return;
        setRetrying(true);
        try {
            await retryTask(entry.taskId);
        } finally {
            setRetrying(false);
        }
    };

    return (
        <Card variant="default" padding={3}>
            <HStack vAlign="start" gap={2}>
                <StatusDot
                    variant={statusVariant}
                    label={statusLabel}
                    isPulsing={isInProgress}
                />
                <VStack gap={1.5} className="min-w-0 flex-1">
                    <HStack vAlign="center" hAlign="between" gap={2}>
                        <StackItem size="fill">
                            <Text type="body" weight="medium" maxLines={1}>
                                {displayIdentity(entry.url)}
                            </Text>
                        </StackItem>
                        <HStack vAlign="center" gap={1}>
                            {isDone && result && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    label={t('dialog.play')}
                                    icon={<Icon icon={PlayCircle as unknown as IconType} size="sm" />}
                                    onClick={() => requestPlay(result)}
                                />
                            )}
                            {canCancel && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    label={t('dialog.cancel')}
                                    icon={<Icon icon={CircleX as unknown as IconType} size="sm" />}
                                    isLoading={cancelling}
                                    isDisabled={cancelling}
                                    onClick={() => void cancel()}
                                />
                            )}
                        </HStack>
                    </HStack>

                    {(isPending || isInProgress) && (
                        <Text type="supporting" color="secondary">
                            {stageLabel}
                            {percent !== null ? ` · ${percent.toFixed(1)}%` : ''}
                        </Text>
                    )}

                    {percent !== null && !isDone && !isFailed && !isCancelled && (
                        <ProgressBar
                            label={stageLabel}
                            isLabelHidden
                            value={percent}
                            max={100}
                            variant="accent"
                        />
                    )}

                    {isFailed && (
                        <Banner
                            status="error"
                            title={errorSummary}
                            endContent={(
                                <HStack gap={1}>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        label={t('dialog.copyUrl')}
                                        icon={<Icon icon={Copy as unknown as IconType} size="sm" />}
                                        onClick={() => void copyUrl()}
                                    />
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        label={t('dialog.retry')}
                                        icon={<Icon icon={RotateCcw as unknown as IconType} size="sm" />}
                                        isLoading={retrying}
                                        onClick={() => void retry()}
                                    />
                                </HStack>
                            )}
                        >
                            {taskView?.result ? (
                                <Text type="supporting" color="secondary" className="break-all">
                                    {taskView.result}
                                </Text>
                            ) : null}
                        </Banner>
                    )}

                    {isCancelled && (
                        <Text type="supporting" color="secondary">
                            {t('dialog.cancelled')}
                        </Text>
                    )}

                    {isDone && result && (
                        <Text type="supporting" color="secondary" maxLines={1}>
                            {result.fileName}
                            {result.attachedSrtFileName ? '' : ` · ${t('dialog.noSubtitle')}`}
                        </Text>
                    )}
                </VStack>
            </HStack>
        </Card>
    );
};

export default YoutubeImportTaskRow;
