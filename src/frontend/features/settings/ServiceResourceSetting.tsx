import React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    AudioLines,
    BookA,
    Cloud,
    Cpu,
    Eraser,
    HardDrive,
    Languages,
    Sparkles,
} from 'lucide-react';

import { Banner } from '@astryxdesign/core/Banner';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import SettingsPageShell from '@/frontend/features/settings/components/form/SettingsPageShell';
import { SettingField, SettingSection, SettingsLoadingSkeleton } from '@/frontend/features/settings/components/form';
import { AuthorSupportBanner } from '@/frontend/components/shared/AuthorSupportBanner';
import { ResourcePackCard } from '@/frontend/features/settings/components/ResourcePackCard';
import EmbeddingModelCard from '@/frontend/features/settings/components/EmbeddingModelCard';
import ImportedDictionaryCard from '@/frontend/features/settings/components/ImportedDictionaryCard';
import DictionaryEnhancementCard from '@/frontend/features/settings/components/DictionaryEnhancementCard';
import { OpenAiCredentialCard } from '@/frontend/features/settings/components/OpenAiCredentialCard';
import { SETTINGS_DETAIL_SWR_OPTIONS, settingsApi } from '@/frontend/features/settings/settingsApi';
import { useAutoSaveSettingsForm } from '@/frontend/features/settings/useAutoSaveSettingsForm';
import { useServiceResourceActions } from '@/frontend/features/settings/hooks/useServiceResourceActions';
import { subscribeLocalAiDownloadProgress } from '@/frontend/features/settings/settingsEvents';
import { SETTING_ROW_TESTIDS } from '@/common/constants/qa-testids';
import type { EngineSelectionSettingVO } from '@/common/types/vo/engine-selection-setting-vo';
import type { ServiceCredentialSettingFormValues } from '@/common/types/vo/service-credentials-setting-vo';
import { isHardwareSuitableForLocalAi } from '@/common/utils/hardware-profile';

/** GPU 后端在提示文案里的显示名（专有名词，不翻译）。 */
const GPU_ACCELERATION_LABELS: Record<'metal' | 'vulkan', string> = {
    metal: 'Metal',
    vulkan: 'Vulkan',
};

/** 服务与资源页的页内分区（两栏精简布局：本地资源 + 云端服务）。 */
type ResourceTab = 'local' | 'cloud';

/** 分区面板 id，供 Tab 的 aria-controls 引用。 */
const TAB_PANEL_IDS: Record<ResourceTab, string> = {
    local: 'resources-panel-local',
    cloud: 'resources-panel-cloud',
};

/** 拆开下拉项的值：云端选项形如 `openai:<model>`，其余选项就是引擎枚举值本身。 */
const parseEngineValue = (value: string): { engine: string; model: string | null } => {
    const separator = value.indexOf(':');
    if (separator === -1) {
        return { engine: value, model: null };
    }
    return { engine: value.slice(0, separator), model: value.slice(separator + 1) };
};

/**
 * 服务与资源设置页。
 *
 * 采用「本地资源」与「云端服务」两栏信息架构：
 * - 本地资源：硬件能力概览 → AI 与识别能力路由 → 核心视听与音色 → 本地 AI/向量模型 → 词典 → 专项扩展；
 * - 云端服务：厂商快捷预设 → 凭据与可用模型 → 云端向量模型 → 一键应用至全部 AI 功能。
 */
const ServiceResourceSetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');
    const navigate = useNavigate();

    const { data: settings } = useSWR(
        'settings/service-credentials/detail',
        () => settingsApi.getServiceCredentials(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );
    const { data: engineSettings } = useSWR(
        'settings/engine-selection/detail',
        () => settingsApi.getEngineSelection(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );
    const { data: resourceStatus, mutate: refreshResourceStatus } = useSWR(
        'settings/resource-status/detail',
        () => settingsApi.getResourceStatus(),
    );
    const { data: embeddingStatus, mutate: refreshEmbeddingStatus } = useSWR(
        'settings/embedding-model/status',
        () => settingsApi.getEmbeddingModelStatus(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );
    const hardware = resourceStatus?.hardware;
    const suitableForLocalAi = React.useMemo(() => isHardwareSuitableForLocalAi(hardware), [hardware]);
    const fallbackState = resourceStatus?.fallback ?? null;
    const localAiStatus = resourceStatus?.localAi ?? null;

    const credentialForm = useForm<ServiceCredentialSettingFormValues>();
    const preferenceForm = useForm<EngineSelectionSettingVO>();

    const {
        ready: credentialReady,
        saving: credentialSaving,
        error: credentialSaveError,
        initialize: initializeCredentials,
        flush: flushCredentials,
    } = useAutoSaveSettingsForm<ServiceCredentialSettingFormValues>({
        form: credentialForm,
        detailKey: 'settings/service-credentials/detail',
        onSave: async (values) => {
            await settingsApi.saveServiceCredentials({
                openai: {
                    ...(values.openai.key ? { key: values.openai.key } : {}),
                    ...(values.openai.clearKey ? { clearKey: true } : {}),
                    endpoint: values.openai.endpoint,
                    apiFormat: values.openai.apiFormat,
                    models: values.openai.models,
                    disabledModels: values.openai.disabledModels ?? [],
                    embeddingModel: values.openai.embeddingModel ?? '',
                    ...(values.openai.activeProviderId !== undefined ? { activeProviderId: values.openai.activeProviderId } : {}),
                    ...(values.openai.providers !== undefined
                        ? {
                            providers: values.openai.providers.map((item) => ({
                                id: item.id,
                                name: item.name,
                                apiFormat: item.apiFormat,
                                endpoint: item.endpoint,
                                ...(item.key ? { key: item.key } : {}),
                                ...(item.clearKey ? { clearKey: true } : {}),
                                models: item.models,
                                disabledModels: item.disabledModels ?? [],
                            })),
                        }
                        : {}),
                },
                tencent: {
                    ...(values.tencent.secretId ? { secretId: values.tencent.secretId } : {}),
                    ...(values.tencent.secretKey ? { secretKey: values.tencent.secretKey } : {}),
                    ...(values.tencent.clearTencent ? { clearTencent: true } : {}),
                },
            });
        },
    });

    const {
        ready: preferenceReady,
        error: preferenceSaveError,
        initialize: initializePreferences,
    } = useAutoSaveSettingsForm<EngineSelectionSettingVO>({
        form: preferenceForm,
        detailKey: 'settings/engine-selection/detail',
        onSave: async (values) => {
            await settingsApi.saveEngineSelection(values);
        },
    });

    const { setValue } = preferenceForm;
    const watched = useWatch({ control: preferenceForm.control });
    const subtitleEngine = watched.providers?.subtitleTranslationEngine;
    const dictionaryEngine = watched.providers?.dictionaryEngine;

    const cacheTargets = {
        subtitle: subtitleEngine !== undefined && subtitleEngine !== 'none' && subtitleEngine !== 'invalid',
        dictionary: dictionaryEngine !== undefined && dictionaryEngine !== 'none' && dictionaryEngine !== 'invalid',
    };

    // 兼容历史 deep link `?tab=preference`（合并后统一落在本地资源页）
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const activeTab: ResourceTab = tabParam === 'cloud' ? 'cloud' : 'local';
    const changeTab = (value: string) => {
        const next = new URLSearchParams(searchParams);
        if (value === 'local') {
            next.delete('tab');
        } else {
            next.set('tab', value);
        }
        setSearchParams(next, { replace: true });
    };

    const {
        testingOpenAiModel,
        openAiTestResults,
        clearingCache,
        cacheConfirmOpen,
        setCacheConfirmOpen,
        changeTranscriptionEngine,
        clearCaches,
        copyText,
        openUrl,
        testOpenAiModel,
        forgetOpenAiTestResult,
    } = useServiceResourceActions({
        t,
        refreshResourceStatus,
        flushCredentials,
        localAiStatus,
        cacheTargets,
    });

    React.useEffect(() => {
        if (!settings) return;
        initializeCredentials({
            openai: {
                ...settings.openai,
                embeddingModel: settings.openai.embeddingModel ?? '',
                key: '',
                clearKey: false,
                providers: settings.openai.providers?.map((item) => ({
                    ...item,
                    key: '',
                    clearKey: false,
                })),
            },
            tencent: {
                ...settings.tencent,
                secretId: '',
                secretKey: '',
                clearTencent: false,
            },
        });
    }, [initializeCredentials, settings]);

    React.useEffect(() => {
        if (!engineSettings) return;
        initializePreferences({
            ...engineSettings,
            providers: {
                ...engineSettings.providers,
                embeddingEngine: engineSettings.providers.embeddingEngine ?? 'auto',
            },
        });
    }, [engineSettings, initializePreferences]);

    const watchedCredentials = useWatch({ control: credentialForm.control, name: 'openai' });
    const watchedProviders = watchedCredentials?.providers ?? settings?.openai.providers;
    const watchedCredentialModels = watchedCredentials?.models ?? settings?.openai.models;
    const watchedDisabledModels = watchedCredentials?.disabledModels ?? settings?.openai.disabledModels;
    const availableModels = React.useMemo(() => {
        if (watchedProviders && watchedProviders.length > 0) {
            return Array.from(new Set(
                watchedProviders.flatMap((provider) => {
                    const disabledSet = new Set(provider.disabledModels ?? []);
                    return provider.models.filter((model) => !disabledSet.has(model));
                }),
            ));
        }
        const models = watchedCredentialModels ?? [];
        const disabled = new Set(watchedDisabledModels ?? []);
        return models.filter((model) => !disabled.has(model));
    }, [watchedProviders, watchedCredentialModels, watchedDisabledModels]);

    React.useEffect(() => {
        const unsubscribe = subscribeLocalAiDownloadProgress((progress) => {
            void refreshResourceStatus((current) => current ? {
                ...current,
                localAi: {
                    ...current.localAi,
                    models: current.localAi.models.map((model) => model.modelId === progress.modelId
                        ? { ...model, downloaded: progress.downloaded, total: progress.total, phase: progress.phase }
                        : model),
                },
            } : current, { revalidate: false });
            if (progress.phase === 'idle') void refreshResourceStatus();
        });
        return unsubscribe;
    }, [refreshResourceStatus]);

    const applyEngineValue = (
        value: string,
        engineKey: 'providers.subtitleTranslationEngine' | 'providers.dictionaryEngine',
        modelField: 'openai.featureModels.subtitleTranslation' | 'openai.featureModels.dictionary',
    ) => {
        const { engine, model } = parseEngineValue(value);
        setValue(engineKey, engine as 'openai' | 'local' | 'tencent' | 'none', { shouldDirty: true });
        setValue(modelField, model ?? '', { shouldDirty: true });
    };

    const composeEngineValue = (engine: string | undefined, model: string | undefined): string | undefined => {
        if (!engine) return undefined;
        return engine === 'openai' ? `openai:${model ?? ''}` : engine;
    };

    const sentenceLearningModel = watched.openai?.featureModels?.sentenceLearning ?? '';
    const sentenceLearningValue = !watched.openai?.enableSentenceLearning
        ? 'none'
        : sentenceLearningModel === 'local'
            ? 'local'
            : availableModels.length > 0
                ? `openai:${sentenceLearningModel}`
                : 'none';

    const applySentenceLearningValue = (value: string) => {
        if (value === 'local') {
            setValue('openai.enableSentenceLearning', true, { shouldDirty: true });
            setValue('openai.featureModels.sentenceLearning', 'local', { shouldDirty: true });
            return;
        }
        const { model } = parseEngineValue(value);
        setValue('openai.enableSentenceLearning', model !== null, { shouldDirty: true });
        setValue('openai.featureModels.sentenceLearning', model ?? '', { shouldDirty: true });
    };

    const cloudFallback = Boolean(fallbackState?.subtitleTranslation || fallbackState?.dictionary);

    const modelOptionItems = React.useMemo(() => {
        if (watchedProviders && watchedProviders.length > 0) {
            const showProviderName = watchedProviders.length > 1;
            const seen = new Set<string>();
            const items: Array<{ value: string; label: string }> = [];
            for (const provider of watchedProviders) {
                const disabledSet = new Set(provider.disabledModels ?? []);
                for (const model of provider.models) {
                    if (disabledSet.has(model) || seen.has(model)) continue;
                    seen.add(model);
                    items.push({
                        value: `openai:${model}`,
                        label: showProviderName && provider.name.trim()
                            ? `${model} · ${provider.name.trim()}`
                            : model,
                    });
                }
            }
            return items;
        }
        return availableModels.map((model) => ({ value: `openai:${model}`, label: model }));
    }, [watchedProviders, availableModels]);

    const subtitleOptions = React.useMemo(() => [
        ...modelOptionItems,
        ...(subtitleEngine === 'openai' && !!watched.openai?.featureModels?.subtitleTranslation && !availableModels.includes(watched.openai.featureModels.subtitleTranslation)
            ? [{ value: `openai:${watched.openai.featureModels.subtitleTranslation}`, label: watched.openai.featureModels.subtitleTranslation, disabled: true }]
            : []),
        ...(subtitleEngine === 'local'
            ? [{ value: 'local', label: t('resources.preference.engineLocalAi'), disabled: true }]
            : []),
        ...(subtitleEngine === 'local-mt'
            ? [{ value: 'local-mt', label: t('resources.preference.engineLocalMtLegacy'), disabled: true }]
            : []),
        { value: 'none', label: t('resources.preference.engineNone') },
    ], [modelOptionItems, availableModels, subtitleEngine, watched.openai, t]);

    const dictionaryOptions = React.useMemo(() => [
        ...modelOptionItems,
        ...(watched.providers?.dictionaryEngine === 'openai' && !!watched.openai?.featureModels?.dictionary && !availableModels.includes(watched.openai.featureModels.dictionary)
            ? [{ value: `openai:${watched.openai.featureModels.dictionary}`, label: watched.openai.featureModels.dictionary, disabled: true }]
            : []),
        ...(watched.providers?.dictionaryEngine === 'local'
            ? [{ value: 'local', label: t('resources.preference.engineLocalAi'), disabled: true }]
            : []),
        { value: 'none', label: t('resources.preference.engineNoSupplement') },
    ], [modelOptionItems, availableModels, watched.providers?.dictionaryEngine, watched.openai, t]);

    const sentenceOptions = React.useMemo(() => [
        { value: 'none', label: t('resources.preference.engineDisabled') },
        ...(sentenceLearningValue === 'local'
            ? [{ value: 'local', label: t('resources.preference.engineLocalAi'), disabled: true }]
            : []),
        ...modelOptionItems,
        ...(sentenceLearningValue.startsWith('openai:') && !availableModels.includes(sentenceLearningValue.slice('openai:'.length))
            ? [{ value: sentenceLearningValue, label: sentenceLearningValue.slice('openai:'.length), disabled: true }]
            : []),
    ], [modelOptionItems, availableModels, sentenceLearningValue, t]);

    if (!credentialReady || !preferenceReady || !resourceStatus) {
        return (
            <SettingsLoadingSkeleton
                title={t('resources.title')}
                description={t('resources.description')}
            />
        );
    }

    return (
        <SettingsPageShell
            title={t('resources.title')}
            description={t('resources.description')}
        >
            <TabList
                value={activeTab}
                onChange={changeTab}
                role="tablist"
                hasDivider
            >
                <Tab value="local" label={t('resources.tabs.local')} panelId={TAB_PANEL_IDS.local} />
                <Tab value="cloud" label={t('resources.tabs.cloud')} panelId={TAB_PANEL_IDS.cloud} />
            </TabList>

            <VStack gap={6} width="100%">
                {credentialSaveError && (
                    <Banner status="error" title={credentialSaveError} />
                )}
                {preferenceSaveError && (
                    <Banner status="error" title={preferenceSaveError} />
                )}

                {activeTab === 'local' && (
                    <VStack id={TAB_PANEL_IDS.local} role="tabpanel" gap={6} width="100%">
                        {hardware && (
                            <Card variant="muted" padding={3}>
                                <VStack gap={3} width="100%">
                                    <HStack gap={2} vAlign="center">
                                        <Icon icon={Cpu as unknown as IconType} size="sm" color="secondary" />
                                        <Text size="sm" weight="medium">
                                            {t('resources.overview.hardwareTitle', {
                                                memory: hardware.totalMemoryGb,
                                                cores: hardware.cpuCount,
                                                gpu: hardware.gpuAcceleration === 'none'
                                                    ? t('resources.overview.gpuNone')
                                                    : GPU_ACCELERATION_LABELS[hardware.gpuAcceleration],
                                            })}
                                        </Text>
                                    </HStack>
                                    {suitableForLocalAi && (
                                        <>
                                            <Divider variant="subtle" />
                                            <AuthorSupportBanner embedded suitableForLocalAi />
                                        </>
                                    )}
                                </VStack>
                            </Card>
                        )}

                        <SettingSection
                            title={t('resources.preference.title')}
                            description={t('resources.preference.description')}
                            icon={Languages as unknown as IconType}
                        >
                            <SettingField
                                title={t('resources.preference.subtitleLabel')}
                                testId={SETTING_ROW_TESTIDS.subtitleTranslation}
                                description={t('resources.preference.subtitleDesc')}
                            >
                                <Selector
                                    label={t('resources.preference.subtitleLabel')}
                                    isLabelHidden
                                    value={composeEngineValue(subtitleEngine, watched.openai?.featureModels?.subtitleTranslation)}
                                    onChange={(val) => applyEngineValue(
                                        val,
                                        'providers.subtitleTranslationEngine',
                                        'openai.featureModels.subtitleTranslation',
                                    )}
                                    options={subtitleOptions}
                                    size="sm"
                                    width={224}
                                />
                            </SettingField>

                            <Divider variant="subtle" />

                            <SettingField
                                title={t('resources.preference.dictionaryLabel')}
                                testId={SETTING_ROW_TESTIDS.dictionary}
                                description={t('resources.preference.dictionaryDesc')}
                            >
                                <Selector
                                    label={t('resources.preference.dictionaryLabel')}
                                    isLabelHidden
                                    value={composeEngineValue(watched.providers?.dictionaryEngine, watched.openai?.featureModels?.dictionary)}
                                    onChange={(val) => applyEngineValue(
                                        val,
                                        'providers.dictionaryEngine',
                                        'openai.featureModels.dictionary',
                                    )}
                                    options={dictionaryOptions}
                                    size="sm"
                                    width={224}
                                />
                            </SettingField>

                            <Divider variant="subtle" />

                            <SettingField
                                title={t('resources.preference.sentenceLabel')}
                                testId={SETTING_ROW_TESTIDS.sentenceLearning}
                                description={t('resources.preference.sentenceDesc')}
                            >
                                <Selector
                                    label={t('resources.preference.sentenceLabel')}
                                    isLabelHidden
                                    value={sentenceLearningValue}
                                    onChange={applySentenceLearningValue}
                                    options={sentenceOptions}
                                    size="sm"
                                    width={224}
                                />
                            </SettingField>

                            {(cacheTargets.subtitle || cacheTargets.dictionary) && (
                                <>
                                    <Divider variant="subtle" />
                                    <SettingField
                                        title={t('resources.preference.cacheLabel')}
                                        description={t('resources.preference.cacheDesc')}
                                    >
                                        <Button
                                            label={t('resources.preference.clearCache')}
                                            size="sm"
                                            variant="secondary"
                                            isLoading={clearingCache}
                                            icon={<Icon icon={Eraser as unknown as IconType} size="sm" />}
                                            onClick={() => setCacheConfirmOpen(true)}
                                        />
                                        <AlertDialog
                                            isOpen={cacheConfirmOpen}
                                            onOpenChange={setCacheConfirmOpen}
                                            title={t('resources.preference.clearCache')}
                                            description={t('resources.preference.cacheDesc')}
                                            actionLabel={t('resources.preference.clearCache')}
                                            cancelLabel={t('common.cancel')}
                                            actionVariant="destructive"
                                            isActionLoading={clearingCache}
                                            onAction={async () => {
                                                if (clearingCache) return;
                                                if (await clearCaches()) {
                                                    setCacheConfirmOpen(false);
                                                }
                                            }}
                                        />
                                    </SettingField>
                                </>
                            )}
                        </SettingSection>

                        <Divider variant="subtle" />

                        <SettingSection
                            title={t('resources.pack.title')}
                            description={t('resources.pack.description')}
                            icon={HardDrive as unknown as IconType}
                        >
                            <ResourcePackCard
                                mode="core"
                                includeTtsVoice
                                transcriptionEngine={resourceStatus.transcriptionEngine}
                                ttsStatus={resourceStatus?.tts ?? null}
                                transcriptionStatus={resourceStatus?.transcription ?? null}
                                diarizationStatus={resourceStatus?.diarization ?? null}
                                onRefresh={() => { void refreshResourceStatus(); }}
                                onChangeEngine={(engine) => { void changeTranscriptionEngine(engine); }}
                                onOpenProxySettings={() => { navigate('/settings/proxy'); }}
                            />
                        </SettingSection>

                        <Divider variant="subtle" />

                        <SettingSection
                            title={t('resources.embedding.title')}
                            description={t('resources.embedding.sectionDesc')}
                            icon={Sparkles as unknown as IconType}
                        >
                            <EmbeddingModelCard
                                status={embeddingStatus ?? null}
                                onInstalled={() => { void refreshEmbeddingStatus(); }}
                                onOpenProxySettings={() => { navigate('/settings/proxy'); }}
                            />
                        </SettingSection>

                        <Divider variant="subtle" />

                        <SettingSection
                            title={t('resources.dictionaries.title')}
                            description={t('resources.dictionaries.description')}
                            icon={BookA as unknown as IconType}
                        >
                            <ImportedDictionaryCard />
                            <Divider variant="subtle" />
                            <DictionaryEnhancementCard
                                onOpenProxySettings={() => { navigate('/settings/proxy'); }}
                            />
                        </SettingSection>

                        <Divider variant="subtle" />

                        <SettingSection
                            title={t('resources.extensions.title')}
                            description={t('resources.extensions.description')}
                            icon={AudioLines as unknown as IconType}
                        >
                            <ResourcePackCard
                                mode="extensions"
                                transcriptionEngine={resourceStatus.transcriptionEngine}
                                ttsStatus={resourceStatus?.tts ?? null}
                                transcriptionStatus={resourceStatus?.transcription ?? null}
                                diarizationStatus={resourceStatus?.diarization ?? null}
                                onRefresh={() => { void refreshResourceStatus(); }}
                                onChangeEngine={(engine) => { void changeTranscriptionEngine(engine); }}
                                onOpenProxySettings={() => { navigate('/settings/proxy'); }}
                            />
                        </SettingSection>
                    </VStack>
                )}

                {activeTab === 'cloud' && (
                    <VStack id={TAB_PANEL_IDS.cloud} role="tabpanel" gap={4} width="100%">
                        {cloudFallback && (
                            <Banner status="warning" title={t('resources.cloud.fallbackHint')} />
                        )}
                        <SettingSection
                            title={t('resources.cloud.title')}
                            description={t('resources.cloud.description')}
                            icon={Cloud as unknown as IconType}
                        >
                            <OpenAiCredentialCard
                                form={credentialForm}
                                testingModel={testingOpenAiModel}
                                testResults={openAiTestResults}
                                onTestModel={(model, providerId) => testOpenAiModel(model, providerId).catch(() => null)}
                                onModelRemoved={forgetOpenAiTestResult}
                                onCopy={(text) => copyText(text).catch(() => null)}
                                onOpenUrl={(url) => openUrl(url).catch(() => null)}
                                disabled={credentialSaving}
                            />
                        </SettingSection>
                    </VStack>
                )}
            </VStack>
        </SettingsPageShell>
    );
};

export default ServiceResourceSetting;
