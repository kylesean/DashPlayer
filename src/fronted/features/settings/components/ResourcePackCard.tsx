import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Download,
    FolderOpen,
    Square,
    Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';

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
    ManualDownloadGuide,
    ManualDownloadPathRow,
    ManualDownloadSourceRow,
} from '@/fronted/components/shared/ManualDownloadGuide';
import { subscribeArchiveDownloadProgress } from '@/fronted/features/settings/settingsEvents';
import { SETTING_ROW_TESTIDS } from '@/common/constants/qa-testids';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { SettingField } from '@/fronted/features/settings/components/form/SettingSection';
import type { ModelDownloadPhase } from '@/common/contracts/model-download-phase';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';

/** 资源包内的资源标识。 */
type PackItemKey = 'tts' | 'transcription';

/** 进度与网速刷新到 UI 的最小间隔（毫秒）：进度事件很密，节流后数字才不会闪。 */
const PROGRESS_RENDER_INTERVAL_MS = 500;

/** 网速的指数滑动平均系数，抑制进度事件抖动。 */
const SPEED_SMOOTHING = 0.3;

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

/** 资源包内单项资源的展示信息与动作。 */
interface PackItem {
    key: PackItemKey;
    title: string;
    description: string;
    ready: boolean;
    /** 手动下载教程里展示的模型文件名。 */
    modelLabel: string;
    /** 有序候选下载地址（首个为主源，其余为备用镜像）。 */
    urls: readonly string[];
    /** 手动下载后应保存到的路径。 */
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
    /** 下载/删除结束后刷新外层聚合状态。 */
    onRefresh: () => void;
    /** 切换字幕识别方式。 */
    onChangeEngine: (engine: TranscriptionEngine) => void;
}

export const ResourcePackCard: React.FC<ResourcePackCardProps> = ({
    transcriptionEngine,
    ttsStatus,
    transcriptionStatus,
    onRefresh,
    onChangeEngine,
}) => {
    const { t } = useTranslation('settings');

    const [downloading, setDownloading] = React.useState(false);
    const [deleting, setDeleting] = React.useState(false);
    const [deleteAlertOpen, setDeleteAlertOpen] = React.useState(false);
    const [activePhase, setActivePhase] = React.useState<ModelDownloadPhase | null>(null);
    /** 正在下载的项；取消时用它决定中断哪一项。 */
    const [activeItemKey, setActiveItemKey] = React.useState<PackItemKey | null>(null);
    /** 整体进度按项数均分：已完成项数 + 当前项的完成比例。 */
    const [packProgress, setPackProgress] = React.useState({ completed: 0, count: 0 });
    /** 展示用的进度与网速；由 liveRef 按固定间隔刷新。 */
    const [live, setLive] = React.useState({ percent: 0, downloaded: 0, total: 0, speed: 0 });
    const liveRef = React.useRef({ percent: 0, downloaded: 0, total: 0, speed: 0 });
    const [error, setError] = React.useState<string | null>(null);
    /** 用户是否点了取消：用于中断串行队列，并区分"取消"与"失败"。 */
    const cancelRequestedRef = React.useRef(false);
    /** 最近一次进度采样，用于估算网速。 */
    const speedSampleRef = React.useRef<{ at: number; downloaded: number } | null>(null);

    /** 记录一次进度采样：写入原始快照，并用指数滑动平均估算网速。 */
    const trackProgress = React.useCallback((downloaded: number, total: number) => {
        const now = Date.now();
        const last = speedSampleRef.current;
        let speed = liveRef.current.speed;
        if (last && now > last.at && downloaded >= last.downloaded) {
            const instant = ((downloaded - last.downloaded) * 1000) / (now - last.at);
            speed = speed === 0 ? instant : speed * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING;
        }
        speedSampleRef.current = { at: now, downloaded };
        liveRef.current = {
            percent: total > 0 ? Math.min(100, Math.floor((downloaded / total) * 100)) : 0,
            downloaded,
            total,
            speed,
        };
    }, []);

    // 按固定节奏把原始进度刷到界面上
    React.useEffect(() => {
        if (!downloading) return undefined;
        const timer = window.setInterval(() => {
            setLive({ ...liveRef.current });
        }, PROGRESS_RENDER_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [downloading]);

    // 订阅主进程推送的下载进度
    React.useEffect(() => {
        const unsubscribe = subscribeArchiveDownloadProgress((detail) => {
            setActivePhase(detail.phase);
            if (detail.phase === 'downloading' && detail.total > 0) {
                trackProgress(detail.downloaded, detail.total);
            }
            if (detail.phase === 'idle') onRefresh();
        });
        return unsubscribe;
    }, [onRefresh, trackProgress]);

    /** 复制文本到剪贴板。 */
    const copyText = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('common.copied'));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    /** 在系统浏览器中打开下载地址。 */
    const openUrl = async (url: string) => {
        try {
            await settingsApi.openUrl(url);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    /** 打开模型文件所在文件夹。 */
    const openFolder = async (path: string) => {
        try {
            await settingsApi.openFolderForFile(path);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    /** 资源包内的各项资源；顺序即下载顺序。 */
    const items: PackItem[] = [
        {
            key: 'tts',
            title: t('resources.pack.itemTts'),
            description: t('resources.pack.itemTtsDesc'),
            ready: ttsStatus?.ready ?? false,
            modelLabel: t('serviceCredentials.localTts.modelFile'),
            urls: ttsStatus?.downloadUrls ?? [],
            targetPath: ttsStatus?.archivePath ?? '',
            download: async () => { await settingsApi.downloadSherpaTtsModel(); },
            cancel: async () => { await settingsApi.cancelSherpaTtsModelDownload(); },
            remove: async () => { await settingsApi.deleteSherpaTtsModel(); },
        },
        {
            key: 'transcription',
            title: t('resources.pack.itemTranscription'),
            description: t('resources.pack.itemTranscriptionDesc'),
            ready: transcriptionStatus?.ready ?? false,
            modelLabel: transcriptionEngine === 'whisper-cpp'
                ? t('serviceCredentials.transcription.whisperCppModelFile')
                : t('serviceCredentials.transcription.sherpaOnnxModelFile'),
            urls: transcriptionStatus?.downloadUrls ?? [],
            targetPath: transcriptionStatus?.archivePath ?? '',
            download: async () => {
                if (transcriptionEngine === 'whisper-cpp') {
                    await settingsApi.downloadWhisperCppModel();
                } else {
                    await settingsApi.downloadParakeetModel();
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
    ];

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

    /**
     * 依次下载资源包里尚未完成的项。
     */
    const downloadPack = async () => {
        cancelRequestedRef.current = false;
        setError(null);
        setDownloading(true);
        setPackProgress({ completed: 0, count: pendingItems.length });
        try {
            for (const item of pendingItems) {
                setActiveItemKey(item.key);
                setActivePhase(null);
                liveRef.current = { percent: 0, downloaded: 0, total: 0, speed: 0 };
                setLive({ percent: 0, downloaded: 0, total: 0, speed: 0 });
                speedSampleRef.current = null;
                await item.download();
                if (cancelRequestedRef.current) break;
                setPackProgress((previous) => ({ ...previous, completed: previous.completed + 1 }));
            }
            if (!cancelRequestedRef.current) {
                toast.success(t('resources.pack.downloaded'));
            }
        } catch (err) {
            if (!cancelRequestedRef.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        } finally {
            setActiveItemKey(null);
            setActivePhase(null);
            setDownloading(false);
            onRefresh();
        }
    };

    /** 取消当前项的下载并中断队列。 */
    const cancelDownload = async () => {
        cancelRequestedRef.current = true;
        const current = items.find((item) => item.key === activeItemKey);
        if (!current) return;
        try {
            await current.cancel();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            onRefresh();
        }
    };

    /** 删除资源包内全部已下载的资源。 */
    const deletePack = async () => {
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
            setDeleting(false);
            setDeleteAlertOpen(false);
            onRefresh();
        }
    };

    const engineOptions = [
        { value: 'whisper-cpp', label: t('resources.pack.engineHardware') },
        { value: 'sherpa-onnx', label: t('resources.pack.engineCompat') },
    ];

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
                    <Text size="xsm" color="secondary">
                        {allReady
                            ? t('resources.pack.sizeHint')
                            : t('resources.pack.progressHint', {
                                size: t('resources.pack.sizeHint'),
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
                        <Text size="xsm" color="secondary">{progressLabel}</Text>
                        <Text size="xsm" color="secondary" hasTabularNumbers>
                            {overallPercent}%
                            {live.speed > 0 ? ` · ${formatSpeed(live.speed)}` : ''}
                            {remainingLabel ? ` · ${remainingLabel}` : ''}
                        </Text>
                    </HStack>
                </VStack>
            )}

            {error && (
                <Banner
                    status="error"
                    title={t('resources.pack.failed', { message: error })}
                />
            )}

            <Divider variant="subtle" />

            {/* 两项资源固定展示：状态一眼可见，识别方式不再藏在详情里 */}
            <VStack gap={3} width="100%">
                {items.map((item, index) => (
                    <VStack key={item.key} gap={2} width="100%">
                        {index > 0 && <Divider variant="subtle" />}

                        <SettingField
                            title={item.title}
                            description={item.description}
                        >
                            <Token
                                label={item.ready
                                    ? t('resources.pack.itemReady')
                                    : t('resources.pack.itemMissing')}
                                size="sm"
                                color={item.ready ? 'green' : 'gray'}
                            />
                            {item.ready && (
                                <IconButton
                                    label={t('common.openFolder')}
                                    tooltip={t('common.openFolder')}
                                    size="sm"
                                    variant="ghost"
                                    icon={<Icon icon={FolderOpen as unknown as IconType} size="sm" />}
                                    onClick={() => openFolder(item.targetPath).catch(() => null)}
                                />
                            )}
                        </SettingField>

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

                        {!item.ready && item.urls.length > 0 && (
                            <ManualDownloadGuide title={t('resources.pack.manualTitle')}>
                                <VStack gap={1} width="100%">
                                    <Text type="label">{t('resources.pack.step1Title')}</Text>
                                    <Text type="supporting" color="secondary">
                                        {t('resources.pack.manualModel', { model: item.modelLabel })}
                                    </Text>
                                    <VStack gap={1.5} width="100%">
                                        {item.urls.map((url, urlIndex) => (
                                            <ManualDownloadSourceRow
                                                key={url}
                                                url={url}
                                                isBackup={urlIndex > 0}
                                                backupLabel={t('resources.pack.backupSource')}
                                                copyLabel={t('resources.pack.copyUrl')}
                                                openLabel={t('resources.pack.openInBrowser')}
                                                onCopy={() => { copyText(url).catch(() => null); }}
                                                onOpen={() => { openUrl(url).catch(() => null); }}
                                            />
                                        ))}
                                    </VStack>
                                </VStack>

                                <VStack gap={1} width="100%">
                                    <Text type="label">{t('resources.pack.step2Title')}</Text>
                                    <ManualDownloadPathRow
                                        path={item.targetPath}
                                        copyLabel={t('resources.pack.copyPath')}
                                        openLabel={t('common.openFolder')}
                                        onCopy={() => { copyText(item.targetPath).catch(() => null); }}
                                        onOpenFolder={() => { openFolder(item.targetPath).catch(() => null); }}
                                    />
                                </VStack>

                                <Text type="supporting" color="secondary">
                                    {t('resources.pack.step3Title')} {t('resources.pack.step3Hint')}
                                </Text>
                            </ManualDownloadGuide>
                        )}
                    </VStack>
                ))}
            </VStack>
        </VStack>
    );
};

export default ResourcePackCard;
