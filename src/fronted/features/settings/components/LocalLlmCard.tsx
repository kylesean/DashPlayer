import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle2,
    Copy,
    Cpu,
    Download,
    ExternalLink,
    FolderOpen,
    Gauge,
    Square,
    Trash2,
    XCircle,
} from 'lucide-react';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

import { ManualDownloadGuide } from '@/fronted/components/shared/ManualDownloadGuide';
import type { LocalAiStatus } from '@/common/contracts/local-ai';

export interface LocalLlmCardProps {
    status: LocalAiStatus | null;
    busy: boolean;
    testingModelId: string | null;
    /** 硬件条件提示；不传时不展示。 */
    hardwareHint?: React.ReactNode;
    /** 删除按钮文案；不传时用设置页通用文案（删除模型）。 */
    deleteLabel?: string;
    /** 删除确认弹窗标题；不传时用设置页通用文案。 */
    deleteConfirmTitle?: string;
    testResultsMap: Record<string, {
        success: boolean;
        warmSec: string;
        tps: string;
        errorMessage?: string;
    } | null>;
    onUseModel: (modelId: string) => void;
    onTestModel: (modelId: string) => void;
    onDownloadModel: (modelId: string) => void;
    onCancelDownload: () => void;
    onDeleteModel: (modelId: string) => void;
    onOpenFolder: (path?: string) => void;
    onCopy: (text: string) => void;
    /** 打开外部下载链接（手动下载教程用）。 */
    onOpenUrl: (url: string) => void;
}

/**
 * 本地增强资源包卡片：模型下载/启用/删除，以及手动导入指南。
 *
 * 主界面只展示"内置模型/自定义模型 + 状态 + 动作"；模型名、体积、内存占用、
 * 下载地址与目录等实现细节收敛到手动下载教程区。
 */
export const LocalLlmCard: React.FC<LocalLlmCardProps> = ({
    status,
    busy,
    testingModelId,
    hardwareHint,
    deleteLabel,
    deleteConfirmTitle,
    testResultsMap,
    onUseModel,
    onTestModel,
    onDownloadModel,
    onCancelDownload,
    onDeleteModel,
    onOpenFolder,
    onCopy,
    onOpenUrl,
}) => {
    const { t } = useTranslation('settings');
    const [modelToDelete, setModelToDelete] = React.useState<string | null>(null);

    /** 官方目录中的内置模型；手动下载教程以它为示例。 */
    const builtinModel = status?.models.find((model) => !model.custom);

    return (
        <VStack gap={4} padding={4}>
            {/* 硬件条件提示：本地增强模型对内存与算力有一定要求 */}
            {hardwareHint && (
                <Card variant="muted" padding={2}>
                    <HStack gap={2} vAlign="start">
                        <Icon icon={Cpu as unknown as IconType} size="sm" />
                        <Text size="xsm" color="secondary">{hardwareHint}</Text>
                    </HStack>
                </Card>
            )}

            {/* 模型列表 */}
            <VStack gap={3}>
                {status?.models.map((model) => {
                    const anyDownloading = status?.models.some((item) => item.phase !== 'idle') ?? false;
                    const isActive = model.ready && model.modelId === status.activeModelId;
                    const isTestingThisModel = testingModelId === model.modelId;
                    const testResult = testResultsMap[model.modelId];

                    const downloadPercent = Math.min(100, Math.floor((model.downloaded / (model.total || 1)) * 100));

                    return (
                        <Card key={model.modelId} variant="default" padding={3}>
                            <VStack gap={2}>
                                <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                                    <HStack gap={2} vAlign="center" wrap="wrap">
                                        <Text weight="medium" size="sm">{model.name}</Text>

                                        {isActive ? (
                                            <Token
                                                label={t('serviceCredentials.localAi.inUse')}
                                                size="sm"
                                                color="green"
                                                icon={<Icon icon={CheckCircle2 as unknown as IconType} size="xsm" />}
                                            />
                                        ) : model.ready ? (
                                            <Token
                                                label={t('serviceCredentials.localAi.readyNotInUse')}
                                                size="sm"
                                                color="gray"
                                            />
                                        ) : model.phase !== 'idle' ? (
                                            <Token
                                                label={model.phase === 'verifying'
                                                    ? t('serviceCredentials.localAi.phaseVerifying')
                                                    : t('serviceCredentials.localAi.phaseDownloading')}
                                                size="sm"
                                                color="blue"
                                            />
                                        ) : (
                                            <Token
                                                label={t('common.notDownloaded')}
                                                size="sm"
                                                color="gray"
                                            />
                                        )}

                                        <Text size="xsm" color="secondary">
                                            {t('serviceCredentials.localAi.aboutSize', { size: model.sizeLabel })}
                                        </Text>

                                        {testResult && (
                                            testResult.success ? (
                                                <HStack gap={2} vAlign="center">
                                                    <Icon icon={CheckCircle2 as unknown as IconType} size="xsm" />
                                                    <Text size="xsm" color="secondary" hasTabularNumbers>
                                                        {testResult.warmSec}s · {testResult.tps} {t('serviceCredentials.localAi.speedTpsUnit')}
                                                    </Text>
                                                </HStack>
                                            ) : (
                                                <HStack gap={1} vAlign="center">
                                                    <Icon icon={XCircle as unknown as IconType} size="xsm" />
                                                    <Text size="xsm" color="disabled">
                                                        {testResult.errorMessage || t('common.testFailed')}
                                                    </Text>
                                                </HStack>
                                            )
                                        )}
                                    </HStack>

                                    <HStack gap={1.5} vAlign="center" wrap="wrap">
                                        {!model.ready && model.phase === 'idle' && (
                                            <Button
                                                label={t('common.download')}
                                                size="sm"
                                                variant="primary"
                                                isDisabled={busy || anyDownloading}
                                                icon={<Icon icon={Download as unknown as IconType} size="sm" />}
                                                onClick={() => onDownloadModel(model.modelId)}
                                            />
                                        )}
                                        {!model.ready && model.phase !== 'idle' && (
                                            <Button
                                                label={t('serviceCredentials.localAi.cancelDownload')}
                                                size="sm"
                                                variant="secondary"
                                                isDisabled={busy}
                                                icon={<Icon icon={Square as unknown as IconType} size="sm" />}
                                                onClick={onCancelDownload}
                                            />
                                        )}
                                        {model.ready && !isActive && (
                                            <Button
                                                label={t('serviceCredentials.localAi.use')}
                                                size="sm"
                                                variant="primary"
                                                isDisabled={busy || testingModelId !== null}
                                                icon={<Icon icon={CheckCircle2 as unknown as IconType} size="sm" />}
                                                onClick={() => onUseModel(model.modelId)}
                                            />
                                        )}
                                        {model.ready && (
                                            <Button
                                                label={isTestingThisModel ? t('serviceCredentials.localAi.testing') : t('serviceCredentials.localAi.test')}
                                                size="sm"
                                                variant="secondary"
                                                isLoading={isTestingThisModel}
                                                isDisabled={busy || testingModelId !== null}
                                                icon={<Icon icon={Gauge as unknown as IconType} size="sm" />}
                                                onClick={() => onTestModel(model.modelId)}
                                            />
                                        )}
                                        {model.ready && (
                                            <Button
                                                label={deleteLabel ?? t('serviceCredentials.localModel.deleteModel')}
                                                size="sm"
                                                variant="ghost"
                                                isDisabled={busy || testingModelId !== null}
                                                icon={<Icon icon={Trash2 as unknown as IconType} size="sm" />}
                                                onClick={() => setModelToDelete(model.modelId)}
                                            />
                                        )}
                                    </HStack>
                                </HStack>

                                {/* 下载/校验进度条 */}
                                {!model.ready && model.phase !== 'idle' && (
                                    <VStack gap={1.5}>
                                        <HStack justify="between" vAlign="center">
                                            <Text size="xsm" color="secondary">
                                                {model.phase === 'verifying' ? t('serviceCredentials.localAi.phaseVerifying') : t('serviceCredentials.localAi.phaseDownloading')}
                                            </Text>
                                            <Text size="xsm" color="secondary" hasTabularNumbers>
                                                {downloadPercent}%
                                            </Text>
                                        </HStack>
                                        <ProgressBar
                                            label="Model Download Progress"
                                            value={downloadPercent}
                                            max={100}
                                            isLabelHidden
                                        />
                                    </VStack>
                                )}

                                {model.error && (
                                    <Banner
                                        status="error"
                                        title={model.error}
                                    />
                                )}
                            </VStack>
                        </Card>
                    );
                })}
            </VStack>

            {/* 删除确认弹窗 */}
            <AlertDialog
                isOpen={modelToDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setModelToDelete(null);
                }}
                title={deleteConfirmTitle ?? t('serviceCredentials.localAi.deleteConfirmTitle')}
                description={t('serviceCredentials.localAi.deleteConfirmDescription')}
                actionLabel={t('serviceCredentials.localAi.confirmDelete')}
                cancelLabel={t('serviceCredentials.localAi.cancelDelete')}
                actionVariant="destructive"
                onAction={() => {
                    if (modelToDelete) {
                        onDeleteModel(modelToDelete);
                        setModelToDelete(null);
                    }
                }}
            />

            {/* 手动下载与导入教程：仅内置模型未就绪时出现 */}
            {builtinModel && !builtinModel.ready && (
                <ManualDownloadGuide title={t('serviceCredentials.localAi.customGuideTitle')}>
                    <VStack gap={1.5}>
                        <Text weight="semibold" size="sm">{t('serviceCredentials.localModel.step1Title')}</Text>
                        {builtinModel.downloadUrls.length > 0 ? (
                            <>
                                <Text size="xsm" color="secondary">
                                    {t('serviceCredentials.localModel.modelToDownload', {
                                        model: `${builtinModel.name}（${t('serviceCredentials.localAi.aboutSize', { size: builtinModel.sizeLabel })}）`,
                                    })}
                                </Text>
                                <Card variant="default" padding={2}>
                                    <VStack gap={2}>
                                        {builtinModel.downloadUrls.map((url, index) => (
                                            <VStack key={url} gap={1}>
                                                <HStack gap={1.5} vAlign="start">
                                                    {index > 0 && (
                                                        <Token
                                                            label={t('serviceCredentials.localModel.backupSource')}
                                                            size="sm"
                                                            color="orange"
                                                        />
                                                    )}
                                                    <Text size="2xs" color="secondary" wordBreak="break-all" hasTabularNumbers>
                                                        {url}
                                                    </Text>
                                                </HStack>
                                                <HStack gap={1}>
                                                    <Button
                                                        label={t('serviceCredentials.localModel.copyDownloadUrl')}
                                                        size="sm"
                                                        variant="ghost"
                                                        icon={<Icon icon={Copy as unknown as IconType} size="xsm" />}
                                                        onClick={() => onCopy(url)}
                                                    />
                                                    <Button
                                                        label={t('serviceCredentials.localModel.openInBrowser')}
                                                        size="sm"
                                                        variant="ghost"
                                                        icon={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                                                        onClick={() => onOpenUrl(url)}
                                                    />
                                                </HStack>
                                            </VStack>
                                        ))}
                                    </VStack>
                                </Card>
                            </>
                        ) : (
                            <Text size="xsm" color="secondary">
                                {t('serviceCredentials.localAi.customGuideStep1')}
                            </Text>
                        )}
                    </VStack>

                    <VStack gap={1.5}>
                        <Text weight="semibold" size="sm">{t('serviceCredentials.localModel.step2Title')}</Text>
                        <Card variant="default" padding={3}>
                            <VStack gap={2}>
                                <Text size="2xs" color="secondary" wordBreak="break-all" hasTabularNumbers>
                                    {status?.modelsDirectory ?? ''}
                                </Text>
                                <HStack gap={2}>
                                    <Button
                                        label={t('serviceCredentials.localAi.copyPath')}
                                        size="sm"
                                        variant="secondary"
                                        isDisabled={!status}
                                        icon={<Icon icon={Copy as unknown as IconType} size="xsm" />}
                                        onClick={() => status && onCopy(status.modelsDirectory)}
                                    />
                                    <Button
                                        label={t('common.openFolder')}
                                        size="sm"
                                        variant="secondary"
                                        isDisabled={!status}
                                        icon={<Icon icon={FolderOpen as unknown as IconType} size="xsm" />}
                                        onClick={() => status && onOpenFolder(status.modelsDirectory)}
                                    />
                                </HStack>
                            </VStack>
                        </Card>
                    </VStack>

                    <Card variant="muted" padding={2}>
                        <VStack gap={1}>
                            <Text weight="semibold" size="sm">{t('serviceCredentials.localModel.step3Title')}</Text>
                            <Text size="xsm" color="secondary">{t('serviceCredentials.localAi.customGuideStep3')}</Text>
                        </VStack>
                    </Card>
                </ManualDownloadGuide>
            )}

            {/* 运行时不可用时的显式提示 */}
            {status && !status.runtimeReady && (
                <Banner
                    status="warning"
                    title={t('serviceCredentials.localAi.runtimeMissing')}
                />
            )}
        </VStack>
    );
};
