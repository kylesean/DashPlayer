import { useState } from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Captions } from 'lucide-react';
import { type DpTask, DpTaskState } from '@/common/contracts/dp-task';
import useDpTaskCenter from '@/fronted/app/stores/dpTaskStore';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { playerApi } from '@/fronted/features/player/playerApi';

/**
 * 无字幕视频的字幕生成入口。
 *
 * 仅在播放页 ``没有可用字幕`` 时渲染：点击后用本地 ASR 生成 SRT，
 * 进度经全局后台任务中心推送；完成后递增字幕重载令牌，播放器自动重建字幕上下文。
 */
export default function SubtitleGenerationPanel() {
    const { t } = useI18nTranslation('player');
    const videoId = usePlaybackSession((s) => s.videoId);
    const [taskId, setTaskId] = useState<number | null>(null);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);

    /**
     * 启动字幕生成任务，并订阅其进度与终态。
     *
     * 失败时任务中心会把错误信息放进 result，前端原样展示，不做兜底改写。
     */
    const start = async (): Promise<void> => {
        if (!videoId || running) {
            return;
        }
        setRunning(true);
        setProgress(null);
        try {
            const id = await useDpTaskCenter.getState().register(
                () => playerApi.startSubtitleGeneration(videoId),
                {
                    onUpdated: (task: DpTask) => {
                        setProgress(task.progress ?? null);
                    },
                    onFinish: (task: DpTask) => {
                        setRunning(false);
                        setTaskId(null);
                        setProgress(null);
                        if (task.status === DpTaskState.DONE) {
                            toast.success(t('subtitleGeneration.done'));
                            // 任务只落库了字幕绑定，前端会话仍指向空字幕：重新解析路径并写入会话，
                            // 再递增重载令牌，播放器才会真正重建字幕上下文。
                            void (async () => {
                                try {
                                    const resolution = await playerApi.getPlayerSubtitle(videoId);
                                    if (resolution.subtitlePath) {
                                        usePlaybackSession.getState().updateFile(resolution.subtitlePath);
                                    }
                                } catch (error) {
                                    toast.error(t('subtitleGeneration.failed', {
                                        message: error instanceof Error ? error.message : String(error),
                                    }));
                                }
                                usePlaybackSession.getState().reloadSubtitles();
                            })();
                            return;
                        }
                        if (task.status === DpTaskState.FAILED) {
                            toast.error(t('subtitleGeneration.failed', { message: String(task.result ?? '') }));
                        }
                    },
                },
            );
            setTaskId(id);
        } catch (error) {
            setRunning(false);
            toast.error(t('subtitleGeneration.failed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        }
    };

    /**
     * 请求取消当前任务；终态仍以任务中心推送的 CANCELLED 为准。
     */
    const cancel = async (): Promise<void> => {
        if (taskId === null) {
            return;
        }
        try {
            await playerApi.cancelSubtitleGeneration(taskId);
        } catch (error) {
            toast.error(t('subtitleGeneration.failed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        }
    };

    return (
        <VStack align="center" justify="center" gap={3} padding={6} width="100%" height="100%">
            <Captions className="h-10 w-10 text-muted-foreground" />
            <Text type="supporting" color="secondary">{t('subtitleGeneration.title')}</Text>
            <Text type="supporting" color="secondary">
                {running ? (progress ?? t('subtitleGeneration.running')) : t('subtitleGeneration.description')}
            </Text>
            <HStack gap={2}>
                {running ? (
                    <Button
                        variant="secondary"
                        label={t('subtitleGeneration.cancel')}
                        onClick={() => void cancel()}
                    />
                ) : (
                    <Button
                        variant="primary"
                        label={t('subtitleGeneration.start')}
                        isDisabled={!videoId}
                        onClick={() => void start()}
                    />
                )}
            </HStack>
        </VStack>
    );
}
