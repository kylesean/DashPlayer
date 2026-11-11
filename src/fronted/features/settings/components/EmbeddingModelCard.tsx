import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Download, Sparkles } from 'lucide-react';
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

    const install = async () => {
        setInstalling(true);
        try {
            await settingsApi.downloadEmbeddingModel();
            toast.success(t('resources.embedding.installed'));
            onInstalled();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setInstalling(false);
        }
    };

    return (
        <Card variant="default" padding={3}>
            <VStack gap={2}>
                <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                    <HStack gap={2} vAlign="center">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                        <Text weight="medium" size="sm">{status?.name ?? 'BGE Small EN v1.5'}</Text>
                        {status?.ready && (
                            <Token label={t('resources.embedding.ready')} size="sm" color="green" />
                        )}
                    </HStack>
                    {!status?.ready && (
                        <Button
                            variant="secondary"
                            size="sm"
                            label={installing ? t('resources.embedding.installing') : t('resources.embedding.install')}
                            isDisabled={installing}
                            icon={<Download className="h-3.5 w-3.5" />}
                            onClick={() => { void install(); }}
                        />
                    )}
                </HStack>
                <Text size="2xs" color="secondary">
                    {t('resources.embedding.description', { size: status?.sizeLabel ?? '35 MB' })}
                </Text>
            </VStack>
        </Card>
    );
}
