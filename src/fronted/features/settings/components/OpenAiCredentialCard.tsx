import React from 'react';
import { type UseFormReturn, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle2,
    Copy,
    ExternalLink,
    ListPlus,
    Plus,
    TestTube,
    Trash2,
    XCircle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { Button } from '@astryxdesign/core/Button';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Card } from '@astryxdesign/core/Card';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea';
import { Selector } from '@astryxdesign/core/Selector';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

import type { ServiceCredentialSettingDetailVO } from '@/common/types/vo/service-credentials-setting-vo';
import type { OpenAiModelUsageFeature } from '@/common/utils/cloud-model-usage';
import { CLOUD_AI_PROVIDER_PRESETS } from '@/common/constants/cloud-ai-provider-presets';
import { AI_API_FORMATS, type AiApiFormat } from '@/common/utils/cloud-ai-api-format';
import { SettingField } from '@/fronted/features/settings/components/form/SettingSection';
import { SETTING_ROW_TESTIDS } from '@/common/constants/qa-testids';

/** 单个模型的连通性测试结果。 */
export interface OpenAiModelTestResult {
    success: boolean;
    message: string;
}

interface OpenAiCredentialCardProps {
    form: UseFormReturn<ServiceCredentialSettingDetailVO>;
    /**
     * 按模型标识现算的占用功能列表。
     */
    usageByModel: Map<string, OpenAiModelUsageFeature[]>;
    /** 正在测试的模型标识；非空时其余测试按钮一并禁用。 */
    testingModel: string | null;
    /** 按模型标识缓存的最近一次测试结果。 */
    testResults: Record<string, OpenAiModelTestResult | null>;
    onTestModel: (model: string) => void;
    /** 模型从列表中删除时回调，用于清理该模型遗留的测试结果。 */
    onModelRemoved: (model: string) => void;
    /** 复制文本到剪贴板。 */
    onCopy: (text: string) => void;
    /** 在系统浏览器中打开地址。 */
    onOpenUrl: (url: string) => void;
    disabled?: boolean;
}

/**
 * 云端服务卡片中的 OpenAI 区块：密钥、接口地址与可用模型列表。
 *
 * 预设通过「使用预设」弹窗选择，选中后回填接口地址与 API 类型，不预填
 * 模型；弹窗里同时提供各厂商控制台网址的复制与跳转，方便申请 API Key。
 */
export const OpenAiCredentialCard: React.FC<OpenAiCredentialCardProps> = ({
    form,
    usageByModel,
    testingModel,
    testResults,
    onTestModel,
    onModelRemoved,
    onCopy,
    onOpenUrl,
    disabled,
}) => {
    const { t } = useTranslation('settings');
    const { setValue } = form;
    const [newModel, setNewModel] = React.useState('');
    const [presetDialogOpen, setPresetDialogOpen] = React.useState(false);
    /** 待确认删除的模型；null 表示没有打开确认弹窗。 */
    const [pendingDeleteModel, setPendingDeleteModel] = React.useState<string | null>(null);

    const openAiKey = useWatch({ control: form.control, name: 'openai.key' }) ?? '';
    const endpoint = useWatch({ control: form.control, name: 'openai.endpoint' }) ?? '';
    const apiFormat = useWatch({ control: form.control, name: 'openai.apiFormat' }) ?? 'openai';
    const openAiModels = useWatch({ control: form.control, name: 'openai.models' }) ?? [];

    const usageLabelMap: Record<OpenAiModelUsageFeature, string> = React.useMemo(() => ({
        sentenceLearning: t('serviceCredentials.openai.usageSentenceLearning'),
        subtitleTranslation: t('serviceCredentials.openai.usageSubtitleTranslation'),
        dictionary: t('serviceCredentials.openai.usageDictionary'),
    }), [t]);

    const apiFormatLabelMap: Record<AiApiFormat, string> = React.useMemo(() => ({
        openai: t('serviceCredentials.openai.apiFormatOpenai'),
        anthropic: t('serviceCredentials.openai.apiFormatAnthropic'),
        gemini: t('serviceCredentials.openai.apiFormatGemini'),
    }), [t]);

    const apiFormatOptions = React.useMemo(() => AI_API_FORMATS.map((format) => ({
        value: format,
        label: apiFormatLabelMap[format],
    })), [apiFormatLabelMap]);

    /** 选中预设后回填接口地址与 API 类型；不触碰密钥与模型列表。 */
    const applyPreset = (presetId: string) => {
        const preset = CLOUD_AI_PROVIDER_PRESETS.find((item) => item.id === presetId);
        if (!preset) return;
        setValue('openai.endpoint', preset.endpoint, { shouldDirty: true });
        setValue('openai.apiFormat', preset.apiFormat, { shouldDirty: true });
        setPresetDialogOpen(false);
    };

    const handleAddModel = () => {
        const model = newModel.trim();
        if (!model) return;
        if (openAiModels.includes(model)) {
            toast.error(`${t('common.saveFailed')}\n${t('serviceCredentials.openai.duplicateModel', { model })}`);
            return;
        }
        setValue('openai.models', [...openAiModels, model], { shouldDirty: true });
        setNewModel('');
    };

    const handleDeleteModel = (model: string) => {
        if (!openAiModels.includes(model) || (usageByModel.get(model)?.length ?? 0) > 0) return;
        setValue(
            'openai.models',
            openAiModels.filter((item) => item !== model),
            { shouldDirty: true },
        );
        onModelRemoved(model);
    };

    return (
        <VStack gap={5} width="100%">
            {/* API Key */}
            <SettingField
                title="API Key"
                description={t('serviceCredentials.openai.keyHint')}
            >
                <TextInput
                    type="password"
                    label="API Key"
                    isLabelHidden
                    value={openAiKey}
                    onChange={(val) => setValue('openai.key', val, { shouldDirty: true })}
                    placeholder="sk-..."
                    size="sm"
                    width={320}
                />
            </SettingField>

            <Divider variant="subtle" />

            {/* API Format */}
            <SettingField
                title={t('serviceCredentials.openai.apiFormatLabel')}
                testId={SETTING_ROW_TESTIDS.apiFormat}
            >
                <Selector
                    label={t('serviceCredentials.openai.apiFormatLabel')}
                    isLabelHidden
                    value={apiFormat}
                    onChange={(val) => setValue('openai.apiFormat', val as AiApiFormat, { shouldDirty: true })}
                    options={apiFormatOptions}
                    size="sm"
                    width={220}
                />
            </SettingField>

            <Divider variant="subtle" />

            {/* Endpoint 是长地址，输入框独占一行 */}
            <VStack gap={1.5} width="100%">
                <HStack justify="between" vAlign="center">
                    <Text type="body" weight="medium">Endpoint</Text>
                    <Button
                        label={t('serviceCredentials.openai.usePreset')}
                        size="sm"
                        variant="secondary"
                        icon={<Icon icon={ListPlus as unknown as IconType} size="sm" />}
                        onClick={() => setPresetDialogOpen(true)}
                    />
                </HStack>
                <TextInput
                    label="Endpoint"
                    isLabelHidden
                    value={endpoint}
                    onChange={(val) => setValue('openai.endpoint', val, { shouldDirty: true })}
                    placeholder={t('serviceCredentials.openai.endpointPlaceholder')}
                    description={t('serviceCredentials.openai.endpointHint')}
                    size="sm"
                />
            </VStack>

            <Divider variant="subtle" />

            {/* Models Table */}
            <VStack gap={2} width="100%">
                <Text type="body" weight="medium">{t('serviceCredentials.openai.modelsLabel')}</Text>
                <Card variant="default" padding={0}>
                    <Table density="compact" dividers="rows">
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{t('serviceCredentials.openai.tableModel')}</TableHeaderCell>
                                <TableHeaderCell>{t('serviceCredentials.openai.tableUsage')}</TableHeaderCell>
                                <TableHeaderCell>{t('serviceCredentials.openai.tableStatus')}</TableHeaderCell>
                                <TableHeaderCell>{t('serviceCredentials.openai.tableAction')}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {openAiModels.map((model) => {
                                const isTestingThisModel = testingModel === model;
                                const result = testResults[model];
                                const usage = usageByModel.get(model) ?? [];

                                return (
                                    <TableRow key={model} data-testid={`model-row-${model}`}>
                                        <TableCell>
                                            <Text size="sm" hasTabularNumbers weight="medium">
                                                {model}
                                            </Text>
                                        </TableCell>

                                        <TableCell>
                                            <Text size="xsm" color="secondary">
                                                {usage.length > 0
                                                    ? usage.map((feature) => usageLabelMap[feature]).join(' / ')
                                                    : t('serviceCredentials.openai.usageNone')}
                                            </Text>
                                        </TableCell>

                                        <TableCell>
                                            {result ? (
                                                <HStack gap={1} vAlign="center">
                                                    <Icon
                                                        icon={(result.success ? CheckCircle2 : XCircle) as unknown as IconType}
                                                        size="xsm"
                                                    />
                                                    <Text
                                                        size="xsm"
                                                        color={result.success ? 'primary' : 'disabled'}
                                                        maxLines={1}
                                                    >
                                                        {result.message}
                                                    </Text>
                                                </HStack>
                                            ) : (
                                                <Text size="xsm" color="secondary">
                                                    {t('serviceCredentials.openai.statusUntested')}
                                                </Text>
                                            )}
                                        </TableCell>

                                        <TableCell>
                                            <HStack justify="end" vAlign="center" gap={1}>
                                                <Button
                                                    label={isTestingThisModel ? t('common.testing') : t('serviceCredentials.openai.tableTest')}
                                                    size="sm"
                                                    variant="secondary"
                                                    isLoading={isTestingThisModel}
                                                    isDisabled={disabled || testingModel !== null}
                                                    icon={<Icon icon={TestTube as unknown as IconType} size="sm" />}
                                                    onClick={() => onTestModel(model)}
                                                />
                                                <IconButton
                                                    label={t('common.delete')}
                                                    tooltip={t('common.delete')}
                                                    size="sm"
                                                    variant="ghost"
                                                    isDisabled={usage.length > 0}
                                                    icon={<Icon icon={Trash2 as unknown as IconType} size="sm" />}
                                                    onClick={() => setPendingDeleteModel(model)}
                                                />
                                            </HStack>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </Card>

                <HStack gap={2} vAlign="center">
                    <TextInput
                        label={t('serviceCredentials.openai.addPlaceholder')}
                        isLabelHidden
                        value={newModel}
                        onChange={setNewModel}
                        placeholder={t('serviceCredentials.openai.addPlaceholder')}
                        onEnter={handleAddModel}
                        size="sm"
                    />
                    <Button
                        label={t('serviceCredentials.openai.addButton')}
                        size="sm"
                        variant="secondary"
                        icon={<Icon icon={Plus as unknown as IconType} size="sm" />}
                        onClick={handleAddModel}
                    />
                </HStack>
                <Text size="xsm" color="secondary">
                    {t('serviceCredentials.openai.usedByHint')}
                </Text>
            </VStack>

            {/* 厂商预设弹窗 */}
            <Dialog isOpen={presetDialogOpen} onOpenChange={setPresetDialogOpen} width={640}>
                <DialogHeader
                    title={t('serviceCredentials.openai.presetDialogTitle')}
                    subtitle={t('serviceCredentials.openai.presetDialogDescription')}
                    onOpenChange={setPresetDialogOpen}
                />
                <VStack gap={2} padding={4}>
                    <ScrollableArea label="Presets" height={440}>
                        <VStack gap={2}>
                            {CLOUD_AI_PROVIDER_PRESETS.map((preset) => (
                                <Card
                                    key={preset.id}
                                    data-testid={`provider-preset-${preset.id}`}
                                    variant="default"
                                    padding={3}
                                    className="rounded-lg"
                                >
                                    <VStack gap={2}>
                                        <HStack justify="between" vAlign="center" gap={3}>
                                            <HStack gap={2} vAlign="center">
                                                <Text weight="semibold" size="sm">{preset.name}</Text>
                                                <span data-testid="provider-preset-format">
                                                    <Token label={apiFormatLabelMap[preset.apiFormat]} size="sm" color="gray" />
                                                </span>
                                            </HStack>
                                            <Button
                                                label={t('serviceCredentials.openai.useThisPreset')}
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => applyPreset(preset.id)}
                                            />
                                        </HStack>
                                        <div data-testid="provider-preset-endpoint" className="font-mono">
                                            <Text size="xsm" color="secondary" hasTabularNumbers wordBreak="break-all">
                                                {preset.endpoint}
                                            </Text>
                                        </div>
                                        <HStack justify="between" vAlign="center" gap={2}>
                                            <Text size="2xs" color="secondary" wordBreak="break-all">
                                                {preset.consoleUrl}
                                            </Text>
                                            <HStack gap={1}>
                                                <Button
                                                    label={t('serviceCredentials.openai.copyLink')}
                                                    size="sm"
                                                    variant="ghost"
                                                    icon={<Icon icon={Copy as unknown as IconType} size="xsm" />}
                                                    onClick={() => onCopy(preset.consoleUrl)}
                                                />
                                                <Button
                                                    label={t('serviceCredentials.openai.openInBrowser')}
                                                    size="sm"
                                                    variant="ghost"
                                                    icon={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                                                    onClick={() => onOpenUrl(preset.consoleUrl)}
                                                />
                                            </HStack>
                                        </HStack>
                                    </VStack>
                                </Card>
                            ))}
                        </VStack>
                    </ScrollableArea>
                </VStack>
            </Dialog>
            <AlertDialog
                isOpen={pendingDeleteModel !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDeleteModel(null);
                }}
                title={t('common.delete')}
                description={t('serviceCredentials.openai.deleteModelConfirm', {
                    model: pendingDeleteModel ?? '',
                    defaultValue: '删除模型 {{model}}？此操作无法撤销。',
                })}
                actionLabel={t('common.delete')}
                cancelLabel={t('common.cancel', { defaultValue: '取消' })}
                actionVariant="destructive"
                onAction={() => {
                    const target = pendingDeleteModel;
                    if (target) {
                        handleDeleteModel(target);
                    }
                    setPendingDeleteModel(null);
                }}
            />
        </VStack>
    );
};
