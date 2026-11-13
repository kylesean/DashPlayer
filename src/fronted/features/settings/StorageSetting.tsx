import * as React from 'react';
import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import {
    SettingField,
    SettingSection,
    SettingsLoadingSkeleton,
} from '@/fronted/features/settings/components/form';
import StorageUsageCard from '@/fronted/features/settings/components/StorageUsageCard';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Banner } from '@astryxdesign/core/Banner';
import { Divider } from '@astryxdesign/core/Divider';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import {
    BookOpenCheck,
    ChartPie,
    Download,
    FolderOpen,
    HardDrive,
    RefreshCw,
    TriangleAlert,
    Trash2,
    Upload,
} from 'lucide-react';
import { swrApiMutate } from '@/fronted/lib/swr-util';
import { toast } from 'react-hot-toast';
import { useForm, Controller } from 'react-hook-form';
import {
    SETTINGS_DETAIL_SWR_OPTIONS,
    settingsApi,
} from '@/fronted/features/settings/settingsApi';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';
import useSWR from 'swr';
import type { StorageStatusVO } from '@/common/types/vo/StorageStatusVO';
import type { StorageSettingVO } from '@/common/contracts/storage-setting-vo';
import type { StorageUsageVO } from '@/common/contracts/storage-usage-vo';
import { learningDataApi } from '@/fronted/features/learning-data/learningDataApi';
import { revalidateReviewQueue } from '@/fronted/features/video-learning/reviewQueue';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { contentCompassApi } from '@/fronted/features/content-compass/contentCompassApi';
import type { ContentCompassStatsVO } from '@/common/types/contentCompass';
import type { AttributionVO } from '@/common/learning/compassAttribution';

type StorageFormValues = StorageSettingVO;

/**
 * 存储偏好设置页面组件。
 *
 * 全面迁移至 Astryx UI 体系：
 * - 危险操作重置：采用 Astryx AlertDialog 模态确认。
 * - 路径输入与文件夹选择：采用 TextInput 与 IconButton。
 * - 按钮与用量卡片：统一使用 Astryx 规范组件。
 *
 * @returns 存储设置 JSX 元素。
 */
const StorageSetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');
    const [storageStatus, setStorageStatus] = React.useState<StorageStatusVO | null>(null);
    const [usage, setUsage] = React.useState<StorageUsageVO | null>(null);
    const [usageLoading, setUsageLoading] = React.useState(true);
    const [isResetDialogOpen, setIsResetDialogOpen] = React.useState(false);
    const [isResetting, setIsResetting] = React.useState(false);
    const [isClearLearningDialogOpen, setIsClearLearningDialogOpen] = React.useState(false);
    const [isClearingLearning, setIsClearingLearning] = React.useState(false);
    const [isExportingLearning, setIsExportingLearning] = React.useState(false);
    const [isImportDialogOpen, setIsImportDialogOpen] = React.useState(false);
    const [isImportingLearning, setIsImportingLearning] = React.useState(false);
    const { data: compassStats, isLoading: compassStatsLoading } = useSWR<ContentCompassStatsVO>(
        'content-compass/stats',
        () => contentCompassApi.getStats({ days: 7 }),
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );
    const { data: compassAttribution } = useSWR<AttributionVO>(
        'content-compass/attribution',
        () => contentCompassApi.getAttribution({ days: 7 }),
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );

    const { data: detail } = useSWR<StorageSettingVO>(
        'settings/storage/detail',
        () => settingsApi.getStorage(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );

    const storageStatusEpochRef = React.useRef(0);
    React.useEffect(() => () => {
        storageStatusEpochRef.current += 1;
    }, []);

    const form = useForm<StorageFormValues>();
    const { control, formState, setValue } = form;

    const loadStorageStatus = React.useCallback(async (configuredPath: string) => {
        const epoch = ++storageStatusEpochRef.current;
        try {
            const nextStatus = await settingsApi.getStorageStatus();
            if (epoch !== storageStatusEpochRef.current) {
                return;
            }
            setStorageStatus(nextStatus);

            if (!nextStatus.available) {
                setUsage(null);
                setUsageLoading(false);
                return;
            }

            setUsageLoading(true);
            try {
                const nextUsage = await settingsApi.getStorageUsage();
                if (epoch === storageStatusEpochRef.current) {
                    setUsage(nextUsage);
                }
            } finally {
                if (epoch === storageStatusEpochRef.current) {
                    setUsageLoading(false);
                }
            }
        } catch (error) {
            if (epoch !== storageStatusEpochRef.current) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            setStorageStatus({
                configuredPath,
                resolvedPath: configuredPath,
                exists: false,
                isDirectory: false,
                readable: false,
                writable: false,
                available: false,
                code: 'missing',
                message,
            });
            setUsage(null);
            setUsageLoading(false);
        }
    }, []);

    const { status: autoSaveStatus, error: autoSaveError, initialize, flush } =
        useAutoSaveSettingsForm<StorageFormValues>({
            form,
            detailKey: 'settings/storage/detail',
            onSave: async (values) => {
                await settingsApi.saveStorage(values.path);
                await loadStorageStatus(values.path);
            },
        });

    React.useEffect(() => {
        if (!detail) {
            return;
        }
        initialize(detail);
    }, [initialize, detail]);

    React.useEffect(() => {
        if (!detail) {
            return;
        }
        const timerId = window.setTimeout(() => {
            loadStorageStatus(detail.path).catch(() => undefined);
        }, 0);
        return () => {
            window.clearTimeout(timerId);
        };
    }, [detail, loadStorageStatus]);

    async function reloadWordLearningClips() {
        try {
            await flush();
            const result = await settingsApi.syncVideoLearningFromOss();
            if (!result?.success) {
                throw new Error(t('storage.syncWordClipsFailed'));
            }
            await swrApiMutate('video-learning/search');
            toast.success(t('storage.wordClipsSync.success'));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('storage.wordClipsSync.error')}\n${message}`);
        }
    }

    const handleClear = async () => {
        try {
            setIsResetting(true);
            await settingsApi.resetDatabase();
            setIsResetDialogOpen(false);
            toast.success(t('storage.resetSuccess'));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('storage.resetFailed')}\n${message}`);
        } finally {
            setIsResetting(false);
        }
    };

    const handleExportLearningData = async () => {
        try {
            setIsExportingLearning(true);
            const result = await learningDataApi.exportLearningData();
            if (result.canceled) {
                return;
            }
            if (!result.success) {
                throw new Error(result.error ?? t('storage.learningData.exportFailed'));
            }
            toast.success(t('storage.learningData.exportSuccess'));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('storage.learningData.exportFailed')}\n${message}`);
        } finally {
            setIsExportingLearning(false);
        }
    };

    const handleClearLearningData = async () => {
        try {
            setIsClearingLearning(true);
            const result = await learningDataApi.resetLearningData();
            setIsClearLearningDialogOpen(false);
            revalidateReviewQueue();
            await swrApiMutate('learning-data/session-summary');
            await swrApiMutate('content-compass/stats');
            toast.success(t('storage.learningData.clearSuccess', {
                encounters: result.encountersDeleted,
                cards: result.reviewCardsDeleted,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('storage.learningData.clearFailed')}\n${message}`);
        } finally {
            setIsClearingLearning(false);
        }
    };

    /**
     * 从备份恢复学习数据。
     *
     * 导入会整体替换现有记录，因此先走确认弹窗；文件对话框被取消时保持静默，
     * 不把「用户主动取消」当成失败提示。
     */
    const handleImportLearningData = async () => {
        try {
            setIsImportingLearning(true);
            const result = await learningDataApi.importLearningData();
            setIsImportDialogOpen(false);
            if (result.canceled) {
                return;
            }
            if (!result.success) {
                throw new Error(result.error ?? t('storage.learningData.importFailed'));
            }
            revalidateReviewQueue();
            await swrApiMutate('learning-data/session-summary');
            await swrApiMutate('content-compass/stats');
            // 字幕标注来自播放会话的词表匹配结果，不是 SWR 缓存；递增重载令牌
            // 让 usePlayerBridge 重新解析并重新匹配，否则要等下次切视频才生效。
            usePlaybackSession.getState().reloadSubtitles();
            toast.success(t('storage.learningData.importSuccess', {
                words: result.wordsRestored ?? 0,
                events: result.encountersRestored ?? 0,
                cards: result.reviewCardsRestored ?? 0,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('storage.learningData.importFailed')}\n${message}`);
        } finally {
            setIsImportingLearning(false);
        }
    };

    const handleOpen = async () => {
        try {
            await settingsApi.openCacheFolder();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`${t('storage.openFailed')}\n${message}`);
        }
    };

    const handleRefreshUsage = React.useCallback(() => {
        if (!detail) {
            return;
        }
        loadStorageStatus(detail.path).catch(() => undefined);
    }, [detail, loadStorageStatus]);

    const libraryAvailable = storageStatus?.available ?? false;
    const canSyncCollections = libraryAvailable && !formState.isDirty && autoSaveStatus !== 'saving';
    const canOpenLibrary = libraryAvailable;

    if (!detail) {
        return (
            <SettingsLoadingSkeleton
                title={t('storage.title')}
                description={`${t('storage.descriptionLine1')} ${t('storage.descriptionLine2')}`}
            />
        );
    }

    return (
        <VStack width="100%" height="fill">
            <SettingsPageShell
                title={t('storage.title')}
                description={t('storage.description')}
            >
                <AlertDialog
                    isOpen={isResetDialogOpen}
                    onOpenChange={setIsResetDialogOpen}
                    title={t('storage.resetConfirmTitle')}
                    description={t('storage.resetConfirmDescription')}
                    actionLabel={t('storage.resetConfirmOk')}
                    cancelLabel={t('storage.resetConfirmCancel')}
                    actionVariant="destructive"
                    isActionLoading={isResetting}
                    onAction={() => handleClear()}
                />

                <AlertDialog
                    isOpen={isClearLearningDialogOpen}
                    onOpenChange={setIsClearLearningDialogOpen}
                    title={t('storage.learningData.clearConfirmTitle')}
                    description={t('storage.learningData.clearConfirmDescription')}
                    actionLabel={t('storage.learningData.clearConfirmOk')}
                    cancelLabel={t('storage.learningData.clearConfirmCancel')}
                    actionVariant="destructive"
                    isActionLoading={isClearingLearning}
                    onAction={() => handleClearLearningData()}
                />

                <AlertDialog
                    isOpen={isImportDialogOpen}
                    onOpenChange={setIsImportDialogOpen}
                    title={t('storage.learningData.importConfirmTitle')}
                    description={t('storage.learningData.importConfirmDescription')}
                    actionLabel={t('storage.learningData.importConfirmOk')}
                    cancelLabel={t('storage.learningData.importConfirmCancel')}
                    actionVariant="destructive"
                    isActionLoading={isImportingLearning}
                    onAction={() => handleImportLearningData()}
                />

                {autoSaveStatus === 'error' && autoSaveError && (
                    <Banner
                        role="alert"
                        status="error"
                        title={autoSaveError}
                    />
                )}

                <SettingSection
                    title={t('storage.sections.location')}
                    description={t('storage.sections.locationDesc')}
                    icon={HardDrive}
                    action={(
                        <Button
                            onClick={handleOpen}
                            variant="secondary"
                            size="sm"
                            label={t('storage.openLibraryFolder')}
                            icon={<Icon icon={FolderOpen} size="sm" />}
                            isDisabled={!canOpenLibrary}
                        />
                    )}
                >
                    <SettingField
                        title={t('storage.libraryPathTitle')}
                        description={t('storage.libraryPathDescription')}
                    >
                        <HStack gap={2} vAlign="center">
                            <Controller
                                name="path"
                                control={control}
                                render={({ field }) => (
                                    <TextInput
                                        label={t('storage.libraryPathTitle')}
                                        isLabelHidden
                                        placeholder="Documents/Refrain"
                                        value={field.value ?? ''}
                                        onChange={(val) => field.onChange(val)}
                                        onBlur={field.onBlur}
                                        size="sm"
                                        width={280}
                                    />
                                )}
                            />
                            <IconButton
                                label={t('storage.chooseLibraryFolder')}
                                tooltip={t('storage.chooseLibraryFolder')}
                                icon={<Icon icon={FolderOpen} size="sm" />}
                                variant="secondary"
                                size="sm"
                                onClick={async () => {
                                    const folder: string[] = await settingsApi.selectStorageFolder({
                                        createDirectory: true,
                                    });
                                    if (folder.length > 0) {
                                        setValue('path', String(folder[0]), {
                                            shouldDirty: true,
                                            shouldTouch: true,
                                        });
                                    }
                                }}
                            />
                        </HStack>
                    </SettingField>
                </SettingSection>

                <Divider />

                <SettingSection
                    title={t('storage.usage.title')}
                    description={t('storage.sections.usageDesc')}
                    icon={ChartPie}
                >
                    <StorageUsageCard
                        usage={usage}
                        loading={usageLoading}
                        onRefresh={handleRefreshUsage}
                    />
                </SettingSection>

                <Divider />

                <SettingSection
                    title={t('storage.sections.sync')}
                    description={t('storage.sections.syncDesc')}
                    icon={RefreshCw}
                >
                    <SettingField
                        title={t('storage.wordClipsTitle')}
                        description={t('storage.wordClipsHint')}
                    >
                        <Button
                            isDisabled={!canSyncCollections}
                            onClick={reloadWordLearningClips}
                            variant="secondary"
                            size="sm"
                            label={t('storage.wordClipsSync.button')}
                            icon={<Icon icon={RefreshCw} size="sm" />}
                        />
                    </SettingField>
                </SettingSection>

                <Divider />

                <SettingSection
                    title={t('storage.sections.learningData')}
                    description={t('storage.sections.learningDataDesc')}
                    icon={BookOpenCheck}
                >
                    <SettingField
                        title={t('storage.learningData.exportTitle')}
                        description={t('storage.learningData.exportDescription')}
                    >
                        <Button
                            variant="secondary"
                            size="sm"
                            label={t('storage.learningData.exportButton')}
                            icon={<Icon icon={Download} size="sm" />}
                            isLoading={isExportingLearning}
                            onClick={handleExportLearningData}
                        />
                    </SettingField>
                    <SettingField
                        title={t('storage.learningData.importTitle')}
                        description={t('storage.learningData.importDescription')}
                    >
                        <Button
                            variant="secondary"
                            size="sm"
                            label={t('storage.learningData.importButton')}
                            icon={<Icon icon={Upload} size="sm" />}
                            onClick={() => setIsImportDialogOpen(true)}
                        />
                    </SettingField>
                    <SettingField
                        title={t('storage.learningData.clearTitle')}
                        description={t('storage.learningData.clearDescription')}
                    >
                        <Button
                            variant="destructive"
                            size="sm"
                            label={t('storage.learningData.clearButton')}
                            icon={<Icon icon={Trash2} size="sm" />}
                            onClick={() => setIsClearLearningDialogOpen(true)}
                        />
                    </SettingField>
                    <SettingField
                        title={t('storage.learningData.recommendationTitle')}
                        description={t('storage.learningData.recommendationDescription')}
                    >
                        <VStack gap={2} width="100%">
                            {compassStatsLoading ? (
                                <Text type="supporting" color="secondary">
                                    {t('storage.learningData.recommendationLoading')}
                                </Text>
                            ) : compassStats && compassStats.shown > 0 ? (
                                <HStack gap={6} vAlign="start" wrap="wrap">
                                    <CompassStat
                                        label={t('storage.learningData.recommendationShown')}
                                        value={String(compassStats.shown)}
                                    />
                                    <CompassStat
                                        label={t('storage.learningData.recommendationOpened')}
                                        value={`${compassStats.opened} · ${formatRate(compassStats.openRate)}`}
                                    />
                                    <CompassStat
                                        label={t('storage.learningData.recommendationDismissed')}
                                        value={`${compassStats.dismissed} · ${formatRate(compassStats.dismissRate)}`}
                                    />
                                    <CompassStat
                                        label={t('storage.learningData.recommendationReviewed')}
                                        value={`${compassStats.reviewed} · ${formatRate(compassStats.reviewRate)}`}
                                    />
                                </HStack>
                            ) : (
                                <Text type="supporting" color="secondary">
                                    {t('storage.learningData.recommendationEmpty')}
                                </Text>
                            )}
                            {compassAttribution && compassAttribution.overall.counts.shown > 0 && (
                                <VStack gap={1} data-testid="recommendation-attribution">
                                    <Text type="supporting" color="secondary">
                                        {t('storage.learningData.attributionTitle')}
                                    </Text>
                                    {compassAttribution.funnels.map((funnel) => (
                                        <Text
                                            key={funnel.reason}
                                            type="supporting"
                                            color="secondary"
                                            className="tabular-nums"
                                        >
                                            {t('storage.learningData.attributionRow', {
                                                reason: t(`storage.learningData.attributionReasons.${funnel.reason}`),
                                                shown: funnel.counts.shown,
                                                opened: funnel.counts.opened,
                                                reviewed: funnel.counts.reviewed,
                                                recalled: funnel.counts.recalled,
                                            })}
                                        </Text>
                                    ))}
                                </VStack>
                            )}
                        </VStack>
                    </SettingField>
                </SettingSection>

                <Divider />

                <SettingSection
                    title={t('storage.sections.danger')}
                    description={t('storage.sections.dangerDesc')}
                    icon={TriangleAlert}
                >
                    <SettingField
                        title={t('storage.resetDatabase')}
                        description={t('storage.resetHint')}
                    >
                        <Button
                            variant="destructive"
                            size="sm"
                            label={t('storage.resetDatabase')}
                            icon={<Icon icon={Trash2} size="sm" />}
                            onClick={() => setIsResetDialogOpen(true)}
                        />
                    </SettingField>
                </SettingSection>
            </SettingsPageShell>
        </VStack>
    );
};

function CompassStat({
    label,
    value,
    hint,
}: {
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <VStack gap={0.5}>
            <Text type="supporting" color="secondary">{label}</Text>
            <Text type="body" weight="semibold">{value}</Text>
            {hint && <Text type="supporting" color="secondary">{hint}</Text>}
        </VStack>
    );
}

function formatRate(rate: number | null): string {
    return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export default StorageSetting;
