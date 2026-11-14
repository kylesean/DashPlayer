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
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';

import type {
    CloudAiProviderProfileFormValue,
    ServiceCredentialSettingFormValues,
} from '@/common/types/vo/service-credentials-setting-vo';
import {
    CLOUD_AI_PROVIDER_PRESETS,
    isLocalLlmEndpoint,
} from '@/common/constants/cloud-ai-provider-presets';
import { AI_API_FORMATS, type AiApiFormat } from '@/common/utils/cloud-ai-api-format';
import { maskSecret } from '@/common/utils/secret-mask';
import { SettingField } from '@/frontend/features/settings/components/form/SettingSection';
import { SETTING_ROW_TESTIDS } from '@/common/constants/qa-testids';

/** 单个模型的连通性测试结果。 */
export interface OpenAiModelTestResult {
    success: boolean;
    message: string;
}

interface OpenAiCredentialCardProps {
    form: UseFormReturn<ServiceCredentialSettingFormValues>;
    /** 正在测试的模型标识；非空时其余测试按钮一并禁用。 */
    testingModel: string | null;
    /** 按模型标识缓存的最近一次测试结果。 */
    testResults: Record<string, OpenAiModelTestResult | null>;
    onTestModel: (model: string, providerId?: string) => void;
    /** 模型从列表中删除时回调，用于清理该模型遗留的测试结果。 */
    onModelRemoved: (model: string, providerId?: string) => void;
    /** 复制文本到剪贴板。 */
    onCopy: (text: string) => void;
    /** 在系统浏览器中打开地址。 */
    onOpenUrl: (url: string) => void;
    disabled?: boolean;
}

/**
 * 云端服务卡片：支持多服务商配置并存，各自维护名称、API Key（显式保存防误触）、
 * API 类型、API URL 与模型列表（启用开关、连通性测试、增删）。
 */
export const OpenAiCredentialCard: React.FC<OpenAiCredentialCardProps> = ({
    form,
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
    const [keyDraft, setKeyDraft] = React.useState('');
    const [presetDialogOpen, setPresetDialogOpen] = React.useState(false);
    const [presetDialogMode, setPresetDialogMode] = React.useState<'fill' | 'add'>('fill');
    /** 待确认删除的模型；null 表示没有打开确认弹窗。 */
    const [pendingDeleteModel, setPendingDeleteModel] = React.useState<string | null>(null);
    /** 是否正在确认删除当前选中的服务商配置。 */
    const [confirmDeleteProvider, setConfirmDeleteProvider] = React.useState(false);

    const openAiKeyHint = useWatch({ control: form.control, name: 'openai.keyHint' }) ?? '';
    const hasOpenAiKey = useWatch({ control: form.control, name: 'openai.hasKey' }) === true;
    const legacyEndpoint = useWatch({ control: form.control, name: 'openai.endpoint' }) ?? '';
    const legacyApiFormat = useWatch({ control: form.control, name: 'openai.apiFormat' }) ?? 'openai';
    const legacyModels = useWatch({ control: form.control, name: 'openai.models' });
    const legacyDisabledModels = useWatch({ control: form.control, name: 'openai.disabledModels' });
    const watchedProviders = useWatch({ control: form.control, name: 'openai.providers' });
    const watchedActiveProviderId = useWatch({ control: form.control, name: 'openai.activeProviderId' });

    const hasProvidersList = Array.isArray(watchedProviders);
    const hasExplicitProviders = hasProvidersList && watchedProviders.length > 0;
    const providers: CloudAiProviderProfileFormValue[] = React.useMemo(() => {
        if (hasProvidersList) {
            return watchedProviders as CloudAiProviderProfileFormValue[];
        }
        return [{
            id: watchedActiveProviderId ?? 'default',
            name: 'Default',
            apiFormat: legacyApiFormat,
            endpoint: legacyEndpoint,
            hasKey: hasOpenAiKey,
            keyHint: openAiKeyHint,
            key: '',
            clearKey: false,
            models: legacyModels ?? [],
            disabledModels: legacyDisabledModels ?? [],
        }];
    }, [
        hasProvidersList,
        watchedProviders,
        watchedActiveProviderId,
        legacyApiFormat,
        legacyEndpoint,
        hasOpenAiKey,
        openAiKeyHint,
        legacyModels,
        legacyDisabledModels,
    ]);

    const emptyFallbackProvider: CloudAiProviderProfileFormValue = React.useMemo(() => ({
        id: '',
        name: '',
        apiFormat: 'openai',
        endpoint: '',
        hasKey: false,
        keyHint: '',
        key: '',
        clearKey: false,
        models: [],
        disabledModels: [],
    }), []);

    const activeProvider = React.useMemo(
        () => providers.find((item) => item.id === watchedActiveProviderId) ?? providers[0] ?? emptyFallbackProvider,
        [providers, watchedActiveProviderId, emptyFallbackProvider],
    );

    const endpoint = activeProvider.endpoint;
    const apiFormat = activeProvider.apiFormat;
    const openAiModels = activeProvider.models;
    const disabledModels = activeProvider.disabledModels ?? [];
    const isLocalEndpoint = isLocalLlmEndpoint(endpoint);
    const isCustomProfile = activeProvider.id === 'custom' || activeProvider.id.startsWith('custom-');

    const apiFormatLabelMap: Record<AiApiFormat, string> = React.useMemo(() => ({
        openai: t('serviceCredentials.openai.apiFormatOpenai'),
        'openai-responses': t('serviceCredentials.openai.apiFormatOpenaiResponses'),
        anthropic: t('serviceCredentials.openai.apiFormatAnthropic'),
        gemini: t('serviceCredentials.openai.apiFormatGemini'),
    }), [t]);

    const apiFormatOptions = React.useMemo(() => AI_API_FORMATS.map((format) => ({
        value: format,
        label: apiFormatLabelMap[format],
    })), [apiFormatLabelMap]);

    const updateActiveProvider = (updater: (current: CloudAiProviderProfileFormValue) => CloudAiProviderProfileFormValue) => {
        const nextProvider = updater(activeProvider);
        if (hasExplicitProviders) {
            const nextProviders = providers.map((item) => (item.id === activeProvider.id ? nextProvider : item));
            setValue('openai.providers', nextProviders, { shouldDirty: true });
            const allModels = Array.from(new Set(nextProviders.flatMap((p) => p.models)));
            const allEnabled = new Set(
                nextProviders.flatMap((p) => {
                    const disabledSet = new Set(p.disabledModels ?? []);
                    return p.models.filter((m) => !disabledSet.has(m));
                }),
            );
            setValue('openai.models', allModels, { shouldDirty: true });
            setValue('openai.disabledModels', allModels.filter((m) => !allEnabled.has(m)), { shouldDirty: true });
        } else {
            setValue('openai.models', nextProvider.models, { shouldDirty: true });
            setValue('openai.disabledModels', nextProvider.disabledModels ?? [], { shouldDirty: true });
        }
        setValue('openai.endpoint', nextProvider.endpoint, { shouldDirty: true });
        setValue('openai.apiFormat', nextProvider.apiFormat, { shouldDirty: true });
        setValue('openai.hasKey', nextProvider.hasKey, { shouldDirty: true });
        setValue('openai.keyHint', nextProvider.keyHint, { shouldDirty: true });
        setValue('openai.key', nextProvider.key, { shouldDirty: true });
        setValue('openai.clearKey', nextProvider.clearKey, { shouldDirty: true });
    };

    const switchActiveProvider = (targetId: string) => {
        const target = providers.find((item) => item.id === targetId);
        if (!target) return;
        setValue('openai.activeProviderId', target.id, { shouldDirty: true });
        setValue('openai.endpoint', target.endpoint, { shouldDirty: true });
        setValue('openai.apiFormat', target.apiFormat, { shouldDirty: true });
        setValue('openai.hasKey', target.hasKey, { shouldDirty: true });
        setValue('openai.keyHint', target.keyHint, { shouldDirty: true });
        setValue('openai.key', target.key, { shouldDirty: true });
        setValue('openai.clearKey', target.clearKey, { shouldDirty: true });
        setKeyDraft('');
    };

    const addProviderFromPreset = (presetId?: string) => {
        const preset = presetId
            ? CLOUD_AI_PROVIDER_PRESETS.find((item) => item.id === presetId)
            : undefined;
        const existingIds = new Set(providers.map((item) => item.id));
        const baseId = preset?.id ?? 'custom';
        const baseName = preset?.name ?? t('serviceCredentials.openai.customProvider');
        let nextId = baseId;
        let suffix = 2;
        while (existingIds.has(nextId)) {
            nextId = `${baseId}-${suffix}`;
            suffix += 1;
        }
        const nextName = nextId === baseId ? baseName : `${baseName} ${suffix - 1}`;
        const created: CloudAiProviderProfileFormValue = {
            id: nextId,
            name: nextName,
            apiFormat: preset?.apiFormat ?? 'openai',
            endpoint: preset?.endpoint ?? '',
            hasKey: false,
            keyHint: '',
            key: '',
            clearKey: false,
            models: [],
            disabledModels: [],
        };
        const nextProviders = [...providers, created];
        setValue('openai.providers', nextProviders, { shouldDirty: true });
        setValue('openai.activeProviderId', created.id, { shouldDirty: true });
        setValue('openai.endpoint', created.endpoint, { shouldDirty: true });
        setValue('openai.apiFormat', created.apiFormat, { shouldDirty: true });
        setValue('openai.hasKey', false, { shouldDirty: true });
        setValue('openai.keyHint', '', { shouldDirty: true });
        setValue('openai.key', '', { shouldDirty: true });
        setValue('openai.clearKey', false, { shouldDirty: true });
        setKeyDraft('');
        setPresetDialogOpen(false);
    };

    const handleRemoveActiveProvider = () => {
        if (!hasExplicitProviders) return;
        const remaining = providers.filter((item) => item.id !== activeProvider.id);
        const fallback = remaining[0];
        setValue('openai.providers', remaining, { shouldDirty: true });
        const allModels = Array.from(new Set(remaining.flatMap((p) => p.models)));
        const allEnabled = new Set(
            remaining.flatMap((p) => {
                const disabledSet = new Set(p.disabledModels ?? []);
                return p.models.filter((m) => !disabledSet.has(m));
            }),
        );
        setValue('openai.models', allModels, { shouldDirty: true });
        setValue('openai.disabledModels', allModels.filter((m) => !allEnabled.has(m)), { shouldDirty: true });
        setValue('openai.activeProviderId', fallback?.id ?? '', { shouldDirty: true });
        setValue('openai.endpoint', fallback?.endpoint ?? '', { shouldDirty: true });
        setValue('openai.apiFormat', fallback?.apiFormat ?? 'openai', { shouldDirty: true });
        setValue('openai.hasKey', fallback?.hasKey ?? false, { shouldDirty: true });
        setValue('openai.keyHint', fallback?.keyHint ?? '', { shouldDirty: true });
        setValue('openai.key', fallback?.key ?? '', { shouldDirty: true });
        setValue('openai.clearKey', fallback?.clearKey ?? false, { shouldDirty: true });
        setKeyDraft('');
    };

    /** 选中预设后回填接口地址与 API 类型；不触碰密钥与模型列表。 */
    const applyPreset = (presetId: string) => {
        if (presetDialogMode === 'add') {
            addProviderFromPreset(presetId);
            return;
        }
        const preset = CLOUD_AI_PROVIDER_PRESETS.find((item) => item.id === presetId);
        if (!preset) return;
        updateActiveProvider((current) => ({
            ...current,
            endpoint: preset.endpoint,
            apiFormat: preset.apiFormat,
        }));
        setPresetDialogOpen(false);
    };

    const handleSaveKey = () => {
        const trimmed = keyDraft.trim();
        if (!trimmed) return;
        updateActiveProvider((current) => ({
            ...current,
            key: trimmed,
            clearKey: false,
            hasKey: true,
            keyHint: maskSecret(trimmed),
        }));
        setKeyDraft('');
        toast.success(t('serviceCredentials.openai.keySaved'));
    };

    const handleClearKey = () => {
        updateActiveProvider((current) => ({
            ...current,
            key: '',
            clearKey: true,
            hasKey: false,
            keyHint: '',
        }));
        setKeyDraft('');
        toast.success(t('serviceCredentials.openai.keyCleared'));
    };

    const handleAddModel = () => {
        const model = newModel.trim();
        if (!model) return;
        if (openAiModels.includes(model)) {
            toast.error(`${t('common.saveFailed')}\n${t('serviceCredentials.openai.duplicateModel', { model })}`);
            return;
        }
        updateActiveProvider((current) => ({
            ...current,
            models: [...current.models, model],
        }));
        setNewModel('');
    };

    const handleToggleModel = (model: string, enabled: boolean) => {
        const nextDisabled = enabled
            ? disabledModels.filter((item) => item !== model)
            : Array.from(new Set([...disabledModels, model]));
        updateActiveProvider((current) => ({
            ...current,
            disabledModels: nextDisabled,
        }));
    };

    const handleDeleteModel = (model: string) => {
        if (!openAiModels.includes(model)) return;
        updateActiveProvider((current) => ({
            ...current,
            models: current.models.filter((item) => item !== model),
            disabledModels: (current.disabledModels ?? []).filter((item) => item !== model),
        }));
        onModelRemoved(model, hasExplicitProviders ? activeProvider.id : undefined);
    };

    return (
        <VStack gap={5} width="100%">
            {/* 已配置服务商切换与新增（支持多厂商并存） */}
            <VStack gap={1.5} width="100%">
                <HStack justify="between" vAlign="center">
                    <Text type="supporting" color="secondary">
                        {t('serviceCredentials.openai.providersLabel')}
                    </Text>
                    {hasExplicitProviders && (
                        <Button
                            label={t('serviceCredentials.openai.deleteProvider')}
                            size="sm"
                            variant="ghost"
                            icon={<Icon icon={Trash2 as unknown as IconType} size="xsm" />}
                            onClick={() => setConfirmDeleteProvider(true)}
                        />
                    )}
                </HStack>
                <HStack gap={1.5} wrap="wrap" vAlign="center">
                    {providers.map((provider) => {
                        const isActive = provider.id === activeProvider.id;
                        return (
                            <Button
                                key={provider.id}
                                data-testid={`provider-tab-${provider.id}`}
                                label={provider.name}
                                size="sm"
                                variant={isActive ? 'primary' : 'secondary'}
                                onClick={() => switchActiveProvider(provider.id)}
                            />
                        );
                    })}
                    <Button
                        label={t('serviceCredentials.openai.addProvider')}
                        size="sm"
                        variant="ghost"
                        icon={<Icon icon={Plus as unknown as IconType} size="sm" />}
                        onClick={() => {
                            setPresetDialogMode('add');
                            setPresetDialogOpen(true);
                        }}
                    />
                </HStack>
            </VStack>

            {hasProvidersList && providers.length === 0 ? (
                <Card variant="muted" padding={3} className="rounded-lg">
                    <Text type="supporting" color="secondary">
                        {t('serviceCredentials.openai.noProvidersHint')}
                    </Text>
                </Card>
            ) : (
                <>
                    {hasExplicitProviders && (
                        <>
                            <Divider variant="subtle" />
                            <SettingField title={t('serviceCredentials.openai.providerNameLabel')}>
                                <TextInput
                                    label={t('serviceCredentials.openai.providerNameLabel')}
                                    isLabelHidden
                                    value={activeProvider.name}
                                    onChange={(val) => updateActiveProvider((current) => ({
                                        ...current,
                                        name: val,
                                    }))}
                                    placeholder={t('serviceCredentials.openai.providerNamePlaceholder')}
                                    size="sm"
                                    width={260}
                                />
                            </SettingField>
                        </>
                    )}

            <Divider variant="subtle" />

            {/* API Key：显式点击保存生效，避免自动保存误触覆盖 */}
            <SettingField
                title="API Key"
                description={isLocalEndpoint
                    ? t('serviceCredentials.openai.localEndpointHint')
                    : t('serviceCredentials.openai.keyHint')}
            >
                <HStack gap={1.5} vAlign="center">
                    <TextInput
                        type="password"
                        label="API Key"
                        isLabelHidden
                        value={keyDraft}
                        onChange={setKeyDraft}
                        onEnter={handleSaveKey}
                        placeholder={activeProvider.hasKey
                            ? t('serviceCredentials.openai.keyPlaceholderSaved', {
                                hint: activeProvider.keyHint || '••••',
                            })
                            : (isLocalEndpoint ? t('serviceCredentials.openai.localKeyPlaceholder') : 'sk-...')}
                        size="sm"
                        width={260}
                    />
                    {keyDraft.trim().length > 0 ? (
                        <>
                            <Button
                                label={t('serviceCredentials.openai.saveKey')}
                                size="sm"
                                variant="primary"
                                isDisabled={disabled}
                                onClick={handleSaveKey}
                            />
                            <Button
                                label={t('serviceCredentials.openai.cancelKeyEdit')}
                                size="sm"
                                variant="ghost"
                                onClick={() => setKeyDraft('')}
                            />
                        </>
                    ) : (
                        activeProvider.hasKey && (
                            <Button
                                label={t('serviceCredentials.openai.clearKey')}
                                size="sm"
                                variant="ghost"
                                isDisabled={disabled}
                                onClick={handleClearKey}
                            />
                        )
                    )}
                </HStack>
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
                    onChange={(val) => updateActiveProvider((current) => ({
                        ...current,
                        apiFormat: val as AiApiFormat,
                    }))}
                    options={apiFormatOptions}
                    size="sm"
                    width={220}
                />
            </SettingField>

            <Divider variant="subtle" />

            {/* API URL 是长地址，输入框独占一行 */}
            <VStack gap={1.5} width="100%">
                <HStack justify="between" vAlign="center">
                    <Text type="body" weight="medium">{t('serviceCredentials.openai.urlLabel')}</Text>
                    <Button
                        label={t('serviceCredentials.openai.usePreset')}
                        size="sm"
                        variant="secondary"
                        icon={<Icon icon={ListPlus as unknown as IconType} size="sm" />}
                        onClick={() => {
                            setPresetDialogMode('fill');
                            setPresetDialogOpen(true);
                        }}
                    />
                </HStack>
                <TextInput
                    label={t('serviceCredentials.openai.urlLabel')}
                    isLabelHidden
                    value={endpoint}
                    onChange={(val) => updateActiveProvider((current) => ({
                        ...current,
                        endpoint: val,
                    }))}
                    placeholder={isCustomProfile
                        ? t('serviceCredentials.openai.customEndpointPlaceholder')
                        : t('serviceCredentials.openai.endpointPlaceholder')}
                    description={isCustomProfile
                        ? t('serviceCredentials.openai.customEndpointHint')
                        : t('serviceCredentials.openai.endpointHint')}
                    size="sm"
                />
            </VStack>

            <Divider variant="subtle" />

            {/* Models List */}
            <VStack gap={2} width="100%">
                <Text type="body" weight="medium">{t('serviceCredentials.openai.modelsLabel')}</Text>
                {openAiModels.length > 0 && (
                    <Card variant="default" padding={0}>
                        <VStack gap={0} width="100%">
                            {openAiModels.map((model, index) => {
                                const resultKey = hasExplicitProviders ? `${activeProvider.id}:${model}` : model;
                                const isTestingThisModel = testingModel === resultKey || testingModel === model;
                                const result = testResults[resultKey] ?? testResults[model];
                                const isEnabled = !disabledModels.includes(model);

                                return (
                                    <React.Fragment key={model}>
                                        {index > 0 && <Divider variant="subtle" />}
                                        <HStack
                                            data-testid={`model-row-${model}`}
                                            justify="between"
                                            vAlign="center"
                                            gap={3}
                                            padding={3}
                                            width="100%"
                                        >
                                            <VStack gap={0.5} className="min-w-0 flex-1">
                                                <HStack gap={2} vAlign="center" wrap="wrap">
                                                    <Text size="sm" hasTabularNumbers weight="medium">
                                                        {model}
                                                    </Text>
                                                    {!isEnabled && (
                                                        <Token
                                                            label={t('serviceCredentials.openai.modelDisabled')}
                                                            size="sm"
                                                            color="gray"
                                                        />
                                                    )}
                                                </HStack>
                                                {result && (
                                                    <HStack gap={1} vAlign="center">
                                                        <Icon
                                                            icon={(result.success ? CheckCircle2 : XCircle) as unknown as IconType}
                                                            size="xsm"
                                                        />
                                                        <Text
                                                            type="supporting"
                                                            color={result.success ? 'primary' : 'disabled'}
                                                            maxLines={1}
                                                        >
                                                            {result.message}
                                                        </Text>
                                                    </HStack>
                                                )}
                                            </VStack>

                                            <HStack vAlign="center" gap={2} className="shrink-0">
                                                <Switch
                                                    label={t('serviceCredentials.openai.modelEnableLabel', { model })}
                                                    isLabelHidden
                                                    value={isEnabled}
                                                    isDisabled={disabled}
                                                    onChange={(checked) => handleToggleModel(model, checked)}
                                                />
                                                <Button
                                                    label={isTestingThisModel ? t('common.testing') : t('serviceCredentials.openai.tableTest')}
                                                    size="sm"
                                                    variant="secondary"
                                                    isLoading={isTestingThisModel}
                                                    isDisabled={disabled || testingModel !== null}
                                                    icon={<Icon icon={TestTube as unknown as IconType} size="sm" />}
                                                    onClick={() => onTestModel(model, hasExplicitProviders ? activeProvider.id : undefined)}
                                                />
                                                <IconButton
                                                    label={t('common.delete')}
                                                    tooltip={t('common.delete')}
                                                    size="sm"
                                                    variant="ghost"
                                                    isDisabled={disabled}
                                                    icon={<Icon icon={Trash2 as unknown as IconType} size="sm" />}
                                                    onClick={() => setPendingDeleteModel(model)}
                                                />
                                            </HStack>
                                        </HStack>
                                    </React.Fragment>
                                );
                            })}
                        </VStack>
                    </Card>
                )}

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
            </VStack>
                </>
            )}

            {/* 厂商预设 / 添加配置弹窗 */}
            <Dialog isOpen={presetDialogOpen} onOpenChange={setPresetDialogOpen} width={640}>
                <DialogHeader
                    title={presetDialogMode === 'add'
                        ? t('serviceCredentials.openai.addProviderDialogTitle')
                        : t('serviceCredentials.openai.presetDialogTitle')}
                    subtitle={presetDialogMode === 'add'
                        ? t('serviceCredentials.openai.addProviderDialogDescription')
                        : t('serviceCredentials.openai.presetDialogDescription')}
                    onOpenChange={setPresetDialogOpen}
                />
                <VStack gap={2} padding={4}>
                    <ScrollableArea label="Presets" height={440}>
                        <VStack gap={2}>
                            {presetDialogMode === 'add' && (
                                <Card
                                    data-testid="provider-preset-custom"
                                    variant="default"
                                    padding={3}
                                    className="rounded-lg"
                                >
                                    <HStack justify="between" vAlign="center" gap={3}>
                                        <VStack gap={0.5} className="min-w-0 flex-1">
                                            <Text weight="semibold" size="sm">
                                                {t('serviceCredentials.openai.customProvider')}
                                            </Text>
                                            <Text type="supporting" color="secondary">
                                                {t('serviceCredentials.openai.customProviderDescription')}
                                            </Text>
                                        </VStack>
                                        <Button
                                            label={t('serviceCredentials.openai.addCustomProvider')}
                                            size="sm"
                                            variant="primary"
                                            onClick={() => addProviderFromPreset()}
                                        />
                                    </HStack>
                                </Card>
                            )}
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
                                            <span data-testid="provider-preset-format">
                                                <Token label={preset.name} size="sm" color="gray" />
                                            </span>
                                            <Button
                                                label={t('serviceCredentials.openai.useThisPreset')}
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => applyPreset(preset.id)}
                                            />
                                        </HStack>
                                        <div data-testid="provider-preset-endpoint" className="font-mono">
                                            <Text type="supporting" color="secondary" hasTabularNumbers wordBreak="break-all">
                                                {preset.endpoint}
                                            </Text>
                                        </div>
                                        <HStack justify="between" vAlign="center" gap={2}>
                                            <Text type="supporting" color="secondary" wordBreak="break-all">
                                                {preset.docsUrl}
                                            </Text>
                                            <HStack gap={1}>
                                                <IconButton
                                                    label={t('serviceCredentials.openai.copyLink')}
                                                    tooltip={t('serviceCredentials.openai.copyLink')}
                                                    size="sm"
                                                    variant="ghost"
                                                    icon={<Icon icon={Copy as unknown as IconType} size="xsm" />}
                                                    onClick={() => onCopy(preset.docsUrl)}
                                                />
                                                <IconButton
                                                    label={t('serviceCredentials.openai.openInBrowser')}
                                                    tooltip={t('serviceCredentials.openai.openInBrowser')}
                                                    size="sm"
                                                    variant="ghost"
                                                    icon={<Icon icon={ExternalLink as unknown as IconType} size="xsm" />}
                                                    onClick={() => onOpenUrl(preset.docsUrl)}
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
                })}
                actionLabel={t('common.delete')}
                cancelLabel={t('common.cancel')}
                actionVariant="destructive"
                onAction={() => {
                    const target = pendingDeleteModel;
                    if (target) {
                        handleDeleteModel(target);
                    }
                    setPendingDeleteModel(null);
                }}
            />
            <AlertDialog
                isOpen={confirmDeleteProvider}
                onOpenChange={setConfirmDeleteProvider}
                title={t('serviceCredentials.openai.deleteProvider')}
                description={activeProvider?.name || activeProvider?.endpoint || ''}
                actionLabel={t('common.delete')}
                cancelLabel={t('common.cancel')}
                actionVariant="destructive"
                onAction={() => {
                    handleRemoveActiveProvider();
                    setConfirmDeleteProvider(false);
                }}
            />
        </VStack>
    );
};
