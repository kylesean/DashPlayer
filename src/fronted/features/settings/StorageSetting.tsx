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
import { ChartPie, FolderOpen, HardDrive, RefreshCw, TriangleAlert, Trash2 } from 'lucide-react';
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

    const { data: detail } = useSWR<StorageSettingVO>(
        'settings/storage/detail',
        () => settingsApi.getStorage(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );

    const form = useForm<StorageFormValues>();
    const { control, formState, setValue } = form;

    const loadStorageStatus = React.useCallback(async (configuredPath: string) => {
        try {
            const nextStatus = await settingsApi.getStorageStatus();
            setStorageStatus(nextStatus);

            if (!nextStatus.available) {
                setUsage(null);
                return;
            }

            setUsageLoading(true);
            try {
                setUsage(await settingsApi.getStorageUsage());
            } finally {
                setUsageLoading(false);
            }
        } catch (error) {
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
        window.setTimeout(() => {
            loadStorageStatus(detail.path).catch(() => undefined);
        }, 0);
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
                                        placeholder="Documents/DashPlayer"
                                        value={field.value ?? ''}
                                        onChange={(val) => field.onChange(val)}
                                        onBlur={field.onBlur}
                                        size="sm"
                                        width={280}
                                    />
                                )}
                            />
                            <IconButton
                                label={t('storage.libraryPathTitle')}
                                tooltip={t('storage.libraryPathTitle')}
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

export default StorageSetting;
