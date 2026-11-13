import React from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import {
    Download,
    FolderOpen,
    Globe,
    RefreshCw,
    Square,
    Trash2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

import {
    cancelPackDownload,
    startPackDownload,
    updatePackCallbacks,
    usePackDownloadState,
} from '@/fronted/features/settings/resourcePackDownloadStore';
import { SETTING_ROW_TESTIDS } from '@/common/constants/qa-testids';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { SettingField } from '@/fronted/features/settings/components/form/SettingSection';
import TtsVoiceCard from '@/fronted/features/settings/components/TtsVoiceCard';
import type { ModelDownloadPhase } from '@/common/contracts/model-download-phase';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';

/** 资源包内的资源标识。 */
type PackItemKey = 'tts' | 'transcription' | 'diarization' | 'phonemeGop' | 'senseVoice';

/** 持久化下载队列的包标识：切走设置标签页或离开设置页后再回来仍可续接进度展示。 */
const SETTINGS_RESOURCE_PACK_ID = 'settings-resource-pack';
const SETTINGS_EXTENSIONS_PACK_ID = 'settings-extensions-pack';

/** 收尾阶段的文案键；下载中的文案统一用 `resources.pack.downloading`。 */
const PHASE_LABEL_KEYS: Partial<Record<ModelDownloadPhase, string>> = {
    verifying: 'resources.pack.verifying',
    extracting: 'resources.pack.extracting',
    installing: 'resources.pack.installing',
};

/** 把字节/秒格式化为网速文案。 */
const formatSpeed = (bytesPerSecond: number): string => {
    const megabytes = bytesPerSecond / (1024 * 1024);
    return megabytes >= 1
        ? `${Math.round(megabytes)} MB/s`
        : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
};

/** 把后端返回 `{ success, message }` 的下载结果统一转换为异常，避免失败时误报成功。 */
function assertDownloadSucceeded(result: { success?: boolean; message?: string } | void): void {
    if (result && result.success === false) {
        throw new Error(result.message || 'Download failed');
    }
}

/** 资源包内单项资源的展示信息与动作。 */
interface PackItem {
    key: PackItemKey;
    title: string;
    description: string;
    ready: boolean;
    /** 本地安装目录/文件路径。 */
    targetPath: string;
    download: () => Promise<void>;
    cancel: () => Promise<void>;
    remove: () => Promise<void>;
}

/**
 * 本地基础资源包卡片：发音、字幕识别二合一。
 *
 * 顶部是整体状态与下载按钮，下载时是一条整体进度（按项数均分）；
 * 下面固定列出「发音 / 字幕识别」两项的状态，识别方式直接可改，
 * 只有缺少文件时才在该项下面出现手动下载教程。
 */
export interface ResourcePackCardProps {
    /** 当前字幕识别方式。 */
    transcriptionEngine: TranscriptionEngine;
    /** 发音模型状态。 */
    ttsStatus: ModelInstallationStatusVO | null;
    /** 字幕识别模型状态。 */
    transcriptionStatus: ModelInstallationStatusVO | null;
    /** 说话人分离模型状态；未加载时为 null。 */
    diarizationStatus: {
        segmentationReady: boolean;
        embeddingReady: boolean;
        ready: boolean;
        segmentationUrls: string[];
        embeddingUrls: string[];
        targetPath?: string;
    } | null;
    /** 展示范围：`core`（核心发音与听写）、`extensions`（说话人分离与音素评分）、`all`（全部）。 */
    mode?: 'core' | 'extensions' | 'all';
    /** 是否把朗读音色选择器与试听面板内嵌到发音项下方。 */
    includeTtsVoice?: boolean;
    /** 下载/删除结束后刷新外层聚合状态。 */
    onRefresh: () => void;
    /** 切换字幕识别方式。 */
    onChangeEngine: (engine: TranscriptionEngine) => void;
    /** 打开网络代理设置页面（下载失败时引导用户配置代理）。 */
    onOpenProxySettings?: () => void;
}

export const ResourcePackCard: React.FC<ResourcePackCardProps> = ({
    transcriptionEngine,
    ttsStatus,
    transcriptionStatus,
    diarizationStatus,
    mode = 'all',
    includeTtsVoice = false,
    onRefresh,
    onChangeEngine,
    onOpenProxySettings,
}) => {
    const { t } = useTranslation('settings');
    const packId = mode === 'extensions' ? SETTINGS_EXTENSIONS_PACK_ID : SETTINGS_RESOURCE_PACK_ID;
    const { data: phonemeGopStatus, mutate: mutatePhonemeGop } = useSWR(
        mode === 'core' ? null : 'phoneme-gop/models/status',
        () => settingsApi.getPhonemeGopModelStatus(),
        { revalidateOnFocus: false },
    );
    const { data: senseVoiceStatus, mutate: mutateSenseVoice } = useSWR(
        mode === 'core' ? null : 'sense-voice/models/status',
        () => settingsApi.getSenseVoiceModelStatus(),
        { revalidateOnFocus: false },
    );

    const [deleting, setDeleting] = React.useState(false);
    const [deletingItemKey, setDeletingItemKey] = React.useState<PackItemKey | null>(null);
    const [deleteAlertOpen, setDeleteAlertOpen] = React.useState(false);
    const deletingRef = React.useRef(false);
    const {
        downloading,
        activeItemKey,
        activePhase,
        packProgress,
        live,
        error,
    } = usePackDownloadState(packId);

    const notifyComplete = React.useCallback(() => {
        toast.success(
            mode === 'extensions'
                ? t('resources.pack.extensionsDownloaded')
                : t('resources.pack.downloaded'),
        );
    }, [mode, t]);

    React.useEffect(() => {
        updatePackCallbacks(packId, {
            onRefresh,
            onComplete: notifyComplete,
        });
    }, [packId, onRefresh, notifyComplete]);

    /** 打开模型文件所在文件夹。 */
    const openFolder = async (path: string) => {
        try {
            await settingsApi.openFolderForFile(path);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    /** 资源包内的各项资源；按 mode 过滤，顺序即下载顺序。 */
    const allItems: PackItem[] = [
        {
            key: 'tts',
            title: t('resources.pack.itemTts'),
            description: t('resources.pack.itemTtsDesc'),
            ready: ttsStatus?.ready ?? false,
            targetPath: ttsStatus?.archivePath ?? '',
            download: async () => { assertDownloadSucceeded(await settingsApi.downloadSherpaTtsModel()); },
            cancel: async () => { await settingsApi.cancelSherpaTtsModelDownload(); },
            remove: async () => { await settingsApi.deleteSherpaTtsModel(); },
        },
        {
            key: 'transcription',
            title: t('resources.pack.itemTranscription'),
            description: t('resources.pack.itemTranscriptionDesc'),
            ready: transcriptionStatus?.ready ?? false,
            targetPath: transcriptionStatus?.archivePath ?? '',
            download: async () => {
                if (transcriptionEngine === 'whisper-cpp') {
                    assertDownloadSucceeded(await settingsApi.downloadWhisperCppModel());
                } else {
                    assertDownloadSucceeded(await settingsApi.downloadParakeetModel());
                }
            },
            cancel: async () => {
                if (transcriptionEngine === 'whisper-cpp') {
                    await settingsApi.cancelWhisperCppModelDownload();
                } else {
                    await settingsApi.cancelParakeetModelDownload();
                }
            },
            remove: async () => {
                if (transcriptionEngine === 'whisper-cpp') {
                    await settingsApi.deleteWhisperCppModel();
                } else {
                    await settingsApi.deleteParakeetModel();
                }
            },
        },
        {
            key: 'diarization',
            title: t('resources.pack.itemDiarization'),
            description: t('resources.pack.itemDiarizationDesc'),
            ready: diarizationStatus?.ready ?? false,
            targetPath: diarizationStatus?.targetPath ?? '',
            download: async () => { assertDownloadSucceeded(await settingsApi.downloadSpeakerDiarizationModel()); },
            cancel: async () => { await settingsApi.cancelSpeakerDiarizationModelDownload(); },
            remove: async () => { await settingsApi.deleteSpeakerDiarizationModel(); },
        },
        {
            key: 'phonemeGop',
            title: t('resources.pack.itemPhonemeGop'),
            description: t('resources.pack.itemPhonemeGopDesc'),
            ready: phonemeGopStatus?.ready ?? false,
            targetPath: phonemeGopStatus?.modelPath ?? '',
            download: async () => {
                const res = await settingsApi.downloadPhonemeGopModel();
                await mutatePhonemeGop();
                assertDownloadSucceeded(res);
            },
            cancel: async () => { await settingsApi.cancelPhonemeGopModelDownload(); },
            remove: async () => {
                await settingsApi.deletePhonemeGopModel();
                await mutatePhonemeGop();
            },
        },
        {
            key: 'senseVoice',
            title: t('resources.pack.itemSenseVoice'),
            description: t('resources.pack.itemSenseVoiceDesc'),
            ready: senseVoiceStatus?.ready ?? false,
            targetPath: senseVoiceStatus?.modelPath ?? '',
            download: async () => {
                const res = await settingsApi.downloadSenseVoiceModel();
                await mutateSenseVoice();
                assertDownloadSucceeded(res);
            },
            cancel: async () => { await settingsApi.cancelSenseVoiceModelDownload(); },
            remove: async () => {
                await settingsApi.deleteSenseVoiceModel();
                await mutateSenseVoice();
            },
        },
    ];

    const items = allItems.filter((item) => {
        if (mode === 'core') {
            return item.key === 'tts' || item.key === 'transcription';
        }
        if (mode === 'extensions') {
            return item.key === 'diarization' || item.key === 'phonemeGop' || item.key === 'senseVoice';
        }
        return true;
    });

    const pendingItems = items.filter((item) => !item.ready);
    const allReady = pendingItems.length === 0;
    const readyCount = items.length - pendingItems.length;

    /** 整体进度百分比：已完成项按整项计入，当前项按其自身进度折算。 */
    const overallPercent = packProgress.count > 0
        ? Math.min(100, Math.floor(((packProgress.completed + live.percent / 100) / packProgress.count) * 100))
        : 0;

    /** 当前这一项的剩余时间文案；网速未知时为 null。 */
    const remainingLabel = (() => {
        if (live.speed <= 0 || live.total <= live.downloaded) return null;
        const seconds = (live.total - live.downloaded) / live.speed;
        if (seconds >= 3600) return t('resources.pack.etaLong');
        return seconds >= 60
            ? t('resources.pack.etaMinutes', {
                minutes: Math.floor(seconds / 60),
                seconds: Math.round(seconds % 60),
            })
            : t('resources.pack.etaSeconds', { seconds: Math.max(1, Math.round(seconds)) });
    })();

    /** 下载中的阶段文案：优先收尾阶段，其次统一的"正在下载所需资源"。 */
    const progressLabel = activePhase && PHASE_LABEL_KEYS[activePhase]
        ? t(PHASE_LABEL_KEYS[activePhase] as string)
        : t('resources.pack.downloading');

    /** 依次下载资源包里尚未完成的项。 */
    const downloadPack = async () => {
        if (downloading || deletingRef.current) return;
        await startPackDownload({
            packId,
            entries: pendingItems.map((item) => ({
                key: item.key,
                download: item.download,
                cancel: item.cancel,
            })),
            onRefresh,
            onComplete: notifyComplete,
        });
    };

    /** 一键下载并配置单个扩展或基础资源项。 */
    const downloadSingleItem = async (item: PackItem) => {
        if (downloading || deletingRef.current) return;
        await startPackDownload({
            packId,
            entries: [{
                key: item.key,
                download: item.download,
                cancel: item.cancel,
            }],
            onRefresh,
            onComplete: notifyComplete,
        });
    };

    /** 删除单个已下载资源项。 */
    const deleteSingleItem = async (item: PackItem) => {
        if (downloading || deletingRef.current) return;
        deletingRef.current = true;
        setDeletingItemKey(item.key);
        try {
            await item.remove();
            toast.success(t('resources.pack.deleted'));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            deletingRef.current = false;
            setDeletingItemKey(null);
            onRefresh();
        }
    };

    /** 取消当前项的下载并中断队列。 */
    const cancelDownload = async () => {
        try {
            await cancelPackDownload(packId);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    /** 删除资源包内全部已下载的资源。 */
    const deletePack = async () => {
        if (downloading || deletingRef.current) return;
        deletingRef.current = true;
        setDeleting(true);
        try {
            for (const item of items) {
                if (item.ready) {
                    await item.remove();
                }
            }
            toast.success(t('resources.pack.deleted'));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            deletingRef.current = false;
            setDeleting(false);
            setDeleteAlertOpen(false);
            onRefresh();
        }
    };

    const engineOptions = [
        { value: 'whisper-cpp', label: t('resources.pack.engineHardware') },
        { value: 'sherpa-onnx', label: t('resources.pack.engineCompat') },
    ];

    const packSizeHint = mode === 'extensions'
        ? t('resources.pack.extensionsSizeHint')
        : t('resources.pack.sizeHint');

    return (
        <VStack gap={4} width="100%">
            {/* 状态行：徽标 + 主操作 */}
            <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                <HStack gap={2} vAlign="center">
                    <StatusDot
                        variant={allReady ? 'success' : 'neutral'}
                        label={allReady ? t('resources.pack.ready') : t('resources.pack.notReady')}
                    />
                    <Text weight="medium" size="sm">
                        {allReady ? t('resources.pack.ready') : t('resources.pack.notReady')}
                    </Text>
                    <Text type="supporting" color="secondary">
                        {allReady
                            ? packSizeHint
                            : t('resources.pack.progressHint', {
                                size: packSizeHint,
                                done: readyCount,
                                total: items.length,
                            })}
                    </Text>
                </HStack>

                <HStack gap={2} vAlign="center">
                    {allReady ? (
                        <>
                            <Button
                                label={t('resources.pack.delete')}
                                size="sm"
                                variant="secondary"
                                isLoading={deleting}
                                icon={<Icon icon={Trash2 as unknown as IconType} size="sm" />}
                                onClick={() => setDeleteAlertOpen(true)}
                            />
                            <AlertDialog
                                isOpen={deleteAlertOpen}
                                onOpenChange={setDeleteAlertOpen}
                                title={t('resources.pack.deleteConfirmTitle')}
                                description={t('resources.pack.deleteConfirmDescription')}
                                actionLabel={t('resources.pack.confirmDelete')}
                                cancelLabel={t('resources.pack.cancelDelete')}
                                onAction={() => void deletePack()}
                                actionVariant="destructive"
                                isActionLoading={deleting}
                            />
                        </>
                    ) : (
                        <Button
                            label={downloading ? t('resources.pack.cancel') : t('resources.pack.download')}
                            size="sm"
                            variant={downloading ? 'secondary' : 'primary'}
                            icon={<Icon icon={(downloading ? Square : Download) as unknown as IconType} size="sm" />}
                            onClick={() => (downloading ? cancelDownload() : downloadPack()).catch(() => null)}
                        />
                    )}
                </HStack>
            </HStack>

            {downloading && (
                <VStack gap={2}>
                    <ProgressBar
                        label="Download Progress"
                        value={overallPercent}
                        max={100}
                        isLabelHidden
                    />
                    <HStack justify="between" vAlign="center">
                        <Text type="supporting" color="secondary">{progressLabel}</Text>
                        <Text type="supporting" color="secondary" hasTabularNumbers>
                            {overallPercent}%
                            {live.speed > 0 ? ` · ${formatSpeed(live.speed)}` : ''}
                            {remainingLabel ? ` · ${remainingLabel}` : ''}
                        </Text>
                    </HStack>
                </VStack>
            )}

            {error && !downloading && (
                <VStack gap={2} width="100%">
                    <Banner
                        status="error"
                        title={t('resources.pack.failed', { message: error })}
                        description={t('resources.pack.proxyHint')}
                    />
                    <HStack gap={2} wrap="wrap">
                        <Button
                            size="sm"
                            variant="secondary"
                            label={t('resources.pack.retry')}
                            icon={<Icon icon={RefreshCw as unknown as IconType} size="sm" />}
                            onClick={() => { void downloadPack(); }}
                        />
                        {onOpenProxySettings && (
                            <Button
                                size="sm"
                                variant="secondary"
                                label={t('resources.pack.openProxySettings')}
                                icon={<Icon icon={Globe as unknown as IconType} size="sm" />}
                                onClick={onOpenProxySettings}
                            />
                        )}
                    </HStack>
                </VStack>
            )}

            <Divider variant="subtle" />

            {/* 单项资源：每项均支持直接一键下载、进度查看或删除 */}
            <VStack gap={3} width="100%">
                {items.map((item, index) => {
                    const isItemDownloading = downloading && activeItemKey === item.key;
                    const isItemDeleting = deletingItemKey === item.key;
                    return (
                        <VStack key={item.key} gap={2} width="100%">
                            {index > 0 && <Divider variant="subtle" />}

                            <SettingField
                                title={item.title}
                                description={item.description}
                            >
                                {isItemDownloading ? (
                                    <Button
                                        label={t('resources.pack.cancel')}
                                        size="sm"
                                        variant="secondary"
                                        icon={<Icon icon={Square as unknown as IconType} size="sm" />}
                                        onClick={() => { void cancelDownload(); }}
                                    />
                                ) : item.ready ? (
                                    <>
                                        <Token
                                            label={t('resources.pack.itemReady')}
                                            size="sm"
                                            color="green"
                                        />
                                        <IconButton
                                            label={t('common.openFolder')}
                                            tooltip={t('common.openFolder')}
                                            size="sm"
                                            variant="ghost"
                                            icon={<Icon icon={FolderOpen as unknown as IconType} size="sm" />}
                                            onClick={() => openFolder(item.targetPath).catch(() => null)}
                                        />
                                        <IconButton
                                            label={t('resources.pack.itemDelete')}
                                            tooltip={t('resources.pack.itemDelete')}
                                            size="sm"
                                            variant="ghost"
                                            isDisabled={downloading || deleting || isItemDeleting}
                                            icon={<Icon icon={Trash2 as unknown as IconType} size="sm" />}
                                            onClick={() => { void deleteSingleItem(item); }}
                                        />
                                    </>
                                ) : (
                                    <Button
                                        label={t('resources.pack.itemDownload')}
                                        size="sm"
                                        variant="secondary"
                                        isDisabled={downloading || deleting}
                                        icon={<Icon icon={Download as unknown as IconType} size="sm" />}
                                        onClick={() => { void downloadSingleItem(item); }}
                                    />
                                )}
                            </SettingField>

                            {item.key === 'tts' && includeTtsVoice && (
                                <TtsVoiceCard onVoiceChange={onRefresh} />
                            )}

                            {item.key === 'transcription' && (
                                <SettingField
                                    title={t('resources.pack.engineLabel')}
                                    testId={SETTING_ROW_TESTIDS.transcription}
                                >
                                    <Selector
                                        label={t('resources.pack.engineLabel')}
                                        isLabelHidden
                                        value={transcriptionEngine}
                                        onChange={(val) => onChangeEngine(val as TranscriptionEngine)}
                                        options={engineOptions}
                                        size="sm"
                                        width={200}
                                    />
                                </SettingField>
                            )}
                        </VStack>
                    );
                })}
            </VStack>
        </VStack>
    );
};

export default ResourcePackCard;
