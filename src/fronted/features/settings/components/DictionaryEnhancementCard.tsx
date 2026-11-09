import { useState } from 'react';
import useSWR from 'swr';
import toast from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { DpTask } from '@/common/contracts/dp-task';
import type { EnglishDictionaryStatusVO } from '@/common/contracts/english-dictionary';
import useDpTaskCenter from '@/fronted/app/stores/dpTaskStore';
import { englishDictionaryApi } from '@/fronted/features/settings/englishDictionaryApi';

/** SWR 缓存键。 */
const STATUS_KEY = 'dictionary-enhancement/status';

/**
 * 英英释义增强包的安装/删除卡片。
 *
 * 数据源为 Princeton WordNet 3.1，仅在用户主动下载后构建；进度经全局
 * 后台任务中心推送。
 */
export default function DictionaryEnhancementCard() {
    const { t } = useI18nTranslation('settings');
    const { data: status, mutate } = useSWR<EnglishDictionaryStatusVO>(STATUS_KEY, englishDictionaryApi.status);
    const [taskId, setTaskId] = useState<number | null>(null);
    const [progress, setProgress] = useState<string | null>(null);

    /** 启动安装并订阅任务进度。 */
    const install = async (): Promise<void> => {
        try {
            const id = await useDpTaskCenter.getState().register(
                () => englishDictionaryApi.install(),
                {
                    onUpdated: (task: DpTask) => setProgress(task.progress ?? null),
                    onFinish: () => {
                        setTaskId(null);
                        setProgress(null);
                        void mutate();
                    },
                },
            );
            setTaskId(id);
        } catch (error) {
            toast.error(t('resources.dictionaryEnhancement.installFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        }
    };

    /** 取消安装。 */
    const cancel = async (): Promise<void> => {
        if (taskId === null) return;
        try {
            await englishDictionaryApi.cancel(taskId);
        } catch (error) {
            toast.error(t('resources.dictionaryEnhancement.installFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        }
    };

    /** 删除已安装的增强包。 */
    const remove = async (): Promise<void> => {
        if (!window.confirm(t('resources.dictionaryEnhancement.removeConfirm'))) {
            return;
        }
        try {
            await englishDictionaryApi.remove();
            await mutate();
        } catch (error) {
            toast.error(t('resources.dictionaryEnhancement.removeFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        }
    };

    const downloading = taskId !== null || Boolean(status?.downloading);

    return (
        <VStack gap={2} width="100%">
            <HStack gap={3} align="center" width="100%" justify="between">
                <VStack gap={0.5}>
                    <Text weight="semibold">
                        {status?.installed
                            ? t('resources.dictionaryEnhancement.installed')
                            : t('resources.dictionaryEnhancement.notInstalled')}
                    </Text>
                    <Text type="supporting" color="secondary">
                        {downloading
                            ? (progress ?? t('resources.dictionaryEnhancement.downloading'))
                            : t('resources.dictionaryEnhancement.size')}
                    </Text>
                </VStack>
                {downloading ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        label={t('resources.dictionaryEnhancement.cancel')}
                        onClick={() => void cancel()}
                    />
                ) : status?.installed ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        label={t('resources.dictionaryEnhancement.remove')}
                        onClick={() => void remove()}
                    />
                ) : (
                    <Button
                        variant="primary"
                        size="sm"
                        label={t('resources.dictionaryEnhancement.install')}
                        onClick={() => void install()}
                    />
                )}
            </HStack>
            {status?.error && !downloading && (
                <Text type="supporting" color="secondary">
                    {t('resources.dictionaryEnhancement.installFailed', { message: status.error })}
                </Text>
            )}
        </VStack>
    );
}
