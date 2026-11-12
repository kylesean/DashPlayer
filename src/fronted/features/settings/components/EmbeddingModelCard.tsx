import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Download, Image, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

import { settingsApi } from '@/fronted/features/settings/settingsApi';

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
}

/**
 * 可选语义模型卡片。
 *
 * 语义向量只增强内容推荐的「兴趣相近」判断；未安装时推荐自动使用词面相似度，
 * 因此这里不把它做成必选项，也不与对话模型的选择状态混在一起。
 */
export default function EmbeddingModelCard({
    status,
    onInstalled,
}: {
    status: EmbeddingModelStatus | null;
    onInstalled: () => void;
}) {
    const { t } = useTranslation('settings');
    const [installing, setInstalling] = useState(false);
    const [installingMultimodal, setInstallingMultimodal] = useState(false);
    const [removing, setRemoving] = useState(false);
    const busyRef = useRef(false);
    const busy = installing || installingMultimodal || removing;

    const install = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setInstalling(true);
        try {
            await settingsApi.downloadEmbeddingModel();
            toast.success(t('resources.embedding.installed'));
            onInstalled();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            busyRef.current = false;
            setInstalling(false);
        }
    };

    const installMultimodal = async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setInstallingMultimodal(true);
        try {
            await settingsApi.downloadEmbeddingMultimodal();
            toast.success(t('resources.embedding.multimodalInstalled'));
            onInstalled();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            busyRef.current = false;
            setInstallingMultimodal(false);
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

    return (
        <Card variant="default" padding={3}>
            <VStack gap={2}>
                <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                    <HStack gap={2} vAlign="center">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                        <Text weight="medium" size="sm">{status?.name ?? 'EmbeddingGemma 2'}</Text>
                        {status?.ready && (
                            <Token label={t('resources.embedding.ready')} size="sm" color="green" />
                        )}
                    </HStack>
                    {!status?.ready ? (
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
                <Text size="2xs" color="secondary">
                    {t('resources.embedding.description', { size: status?.sizeLabel ?? '168 MB' })}
                </Text>
                {status?.ready && (
                    <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                        <HStack gap={2} vAlign="center">
                            <Image className="h-3.5 w-3.5 text-muted-foreground" />
                            <Text size="2xs" color="secondary">
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
