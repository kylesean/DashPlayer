import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Download, Globe, Image, RefreshCw, Sparkles, Square, Trash2 } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

import { settingsApi } from '@/frontend/features/settings/settingsApi';
import {
    subscribeEmbeddingDownloadProgress,
    type EmbeddingDownloadProgressEvent,
} from '@/frontend/features/settings/settingsEvents';

/** 语义模型状态。 */
export interface EmbeddingModelStatus {
    ready: boolean;
    name: string;
    sizeLabel: string;
    bytes: number;
    /** 多模态投影是否就绪；未安装时图像/音频向量不可用。 */
    multimodalReady: boolean;
    /** 多模态投影体积。 */
    multimodalBytes: number;
    downloading?: boolean;
    phase?: 'idle' | 'downloading' | 'verifying';
    downloaded?: number;
    total?: number;
    error?: string | null;
    modelPath?: string;
    downloadUrls?: string[];
}

/**
 * 可选语义模型卡片。
 *
 * 支持一键下载、实时进度展示、取消下载，以及镜像手动下载指引；
 * 未安装时内容推荐会自动回退云端配置或词面相似度。
 */
export default function EmbeddingModelCard({
    status,
    onInstalled,
    onOpenProxySettings,
}: {
    status: EmbeddingModelStatus | null;
    onInstalled: () => void;
    onOpenProxySettings?: () => void;
}) {
    const { t } = useTranslation('settings');
    const [installing, setInstalling] = useState(false);
    const [installingMultimodal, setInstallingMultimodal] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [failedKind, setFailedKind] = useState<'base' | 'multimodal' | null>(null);
    const [liveProgress, setLiveProgress] = useState<EmbeddingDownloadProgressEvent | null>(null);
    const busyRef = useRef(false);

    useEffect(() => {
        const unsubscribe = subscribeEmbeddingDownloadProgress((detail) => {
            setLiveProgress(detail);
            if (detail.phase === 'idle') {
                onInstalled();
            }
        });
        return unsubscribe;
    }, [onInstalled]);

    const activePhase = liveProgress && liveProgress.phase !== 'idle'
        ? liveProgress.phase
        : (status?.phase && status.phase !== 'idle' ? status.phase : null);
    const isDownloading = installing || installingMultimodal || activePhase !== null || Boolean(status?.downloading);
    const progressPercent = liveProgress && liveProgress.phase !== 'idle'
        ? liveProgress.percent
        : (status?.total ? Math.min(100, Math.round(((status.downloaded ?? 0) / status.total) * 100)) : 0);
    const busy = isDownloading || removing;

    const install = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setInstalling(true);
        setLocalError(null);
        setFailedKind(null);
        try {
            await settingsApi.downloadEmbeddingModel();
            toast.success(t('resources.embedding.installed'));
            onInstalled();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLocalError(message);
            setFailedKind('base');
            toast.error(message);
        } finally {
            busyRef.current = false;
            setInstalling(false);
            setLiveProgress(null);
        }
    };

    const installMultimodal = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setInstallingMultimodal(true);
        setLocalError(null);
        setFailedKind(null);
        try {
            await settingsApi.downloadEmbeddingMultimodal();
            toast.success(t('resources.embedding.multimodalInstalled'));
            onInstalled();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLocalError(message);
            setFailedKind('multimodal');
            toast.error(message);
        } finally {
            busyRef.current = false;
            setInstallingMultimodal(false);
            setLiveProgress(null);
        }
    };

    const cancelDownload = async () => {
        try {
            await settingsApi.cancelEmbeddingModelDownload?.();
            onInstalled();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    const remove = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setRemoving(true);
        try {
            await settingsApi.removeEmbeddingModel();
            toast.success(t('resources.embedding.removed'));
            onInstalled();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            busyRef.current = false;
            setRemoving(false);
        }
    };

    const displayError = !isDownloading ? (localError || status?.error || null) : null;

    return (
        <Card variant="default" padding={3}>
            <VStack gap={2} width="100%">
                <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                    <HStack gap={2} vAlign="center">
                        <Sparkles className="h-4 w-4 text-secondary" />
                        <Text weight="medium" size="sm">{status?.name ?? 'EmbeddingGemma 2'}</Text>
                        {status?.ready && (
                            <Token label={t('resources.embedding.ready')} size="sm" color="green" />
                        )}
                    </HStack>
                    {isDownloading ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            label={t('resources.embedding.cancel')}
                            icon={<Square className="h-3.5 w-3.5" />}
                            onClick={() => { void cancelDownload(); }}
                        />
                    ) : !status?.ready ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            label={installing ? t('resources.embedding.installing') : t('resources.embedding.install')}
                            isDisabled={busy}
                            icon={<Download className="h-3.5 w-3.5" />}
                            onClick={() => { void install(); }}
                        />
                    ) : (
                        <Button
                            variant="ghost"
                            size="sm"
                            label={removing ? t('resources.embedding.removing') : t('resources.embedding.remove')}
                            isDisabled={busy}
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => { void remove(); }}
                        />
                    )}
                </HStack>
                <Text type="supporting" color="secondary">
                    {t('resources.embedding.description', { size: status?.sizeLabel ?? '256 MB' })}
                </Text>

                {isDownloading && (
                    <VStack gap={1.5} width="100%">
                        <ProgressBar
                            label={t('resources.embedding.title')}
                            value={progressPercent}
                            max={100}
                            isLabelHidden
                        />
                        <Text type="supporting" color="secondary" hasTabularNumbers>
                            {activePhase === 'verifying'
                                ? t('resources.embedding.phaseVerifying')
                                : t('resources.embedding.phaseDownloading', { percent: progressPercent })}
                        </Text>
                    </VStack>
                )}

                {displayError && (
                    <VStack gap={2} width="100%">
                        <Banner
                            status="error"
                            title={t('resources.pack.failed', { message: displayError })}
                            description={t('resources.pack.proxyHint')}
                        />
                        <HStack gap={2} wrap="wrap">
                            <Button
                                size="sm"
                                variant="secondary"
                                label={t('resources.pack.retry')}
                                icon={<RefreshCw className="h-3.5 w-3.5" />}
                                onClick={() => {
                                    if (failedKind === 'multimodal') {
                                        void installMultimodal();
                                    } else {
                                        void install();
                                    }
                                }}
                            />
                            {onOpenProxySettings && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    label={t('resources.pack.openProxySettings')}
                                    icon={<Globe className="h-3.5 w-3.5" />}
                                    onClick={onOpenProxySettings}
                                />
                            )}
                        </HStack>
                    </VStack>
                )}

                {status?.ready && (
                    <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                        <HStack gap={2} vAlign="center">
                            <Image className="h-3.5 w-3.5 text-secondary" />
                            <Text type="supporting" color="secondary">
                                {status.multimodalReady
                                    ? t('resources.embedding.multimodalReady')
                                    : t('resources.embedding.multimodalHint')}
                            </Text>
                        </HStack>
                        {!status.multimodalReady && (
                            <Button
                                variant="secondary"
                                size="sm"
                                label={installingMultimodal
                                    ? t('resources.embedding.installing')
                                    : t('resources.embedding.multimodalInstall')}
                                isDisabled={busy}
                                icon={<Download className="h-3.5 w-3.5" />}
                                onClick={() => { void installMultimodal(); }}
                            />
                        )}
                    </HStack>
                )}
            </VStack>
        </Card>
    );
}
