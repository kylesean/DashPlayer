import React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    BookA,
    Cloud,
    Eraser,
    HardDrive,
    Languages,
    Sparkles,
} from 'lucide-react';

import { Banner } from '@astryxdesign/core/Banner';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';

import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import { SettingField, SettingSection, SettingsLoadingSkeleton } from '@/fronted/features/settings/components/form';
import { ResourcePackCard } from '@/fronted/features/settings/components/ResourcePackCard';
import { LocalLlmCard } from '@/fronted/features/settings/components/LocalLlmCard';
import EmbeddingModelCard from '@/fronted/features/settings/components/EmbeddingModelCard';
import ImportedDictionaryCard from '@/fronted/features/settings/components/ImportedDictionaryCard';
import DictionaryEnhancementCard from '@/fronted/features/settings/components/DictionaryEnhancementCard';
import { OpenAiCredentialCard } from '@/fronted/features/settings/components/OpenAiCredentialCard';
import { SETTINGS_DETAIL_SWR_OPTIONS, settingsApi } from '@/fronted/features/settings/settingsApi';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';
import { useServiceResourceActions } from '@/fronted/features/settings/hooks/useServiceResourceActions';
import { OPENAI_SUBTITLE_DEFAULT_STYLES } from '@/common/constants/openaiSubtitlePrompts';
import { subscribeLocalAiDownloadProgress } from '@/fronted/features/settings/settingsEvents';
import { SETTING_ROW_TESTIDS } from '@/common/constants/qa-testids';
import type { EngineSelectionSettingVO } from '@/common/types/vo/engine-selection-setting-vo';
import type { ServiceCredentialSettingFormValues } from '@/common/types/vo/service-credentials-setting-vo';
import {
    computeCloudModelUsage,
    type OpenAiModelUsageFeature,
    OPEN_AI_MODEL_USAGE_FEATURES,
} from '@/common/utils/cloud-model-usage';

/** 内存低于该值（GB）时，本地增强模型跑起来会比较吃力。 */
const ENHANCE_MIN_MEMORY_GB = 8;

/** GPU 后端在提示文案里的显示名（专有名词，不翻译）。 */
const GPU_ACCELERATION_LABELS: Record<'metal' | 'vulkan', string> = {
    metal: 'Metal',
    vulkan: 'Vulkan',
};

/** 服务与资源页的页内分区。 */
type ResourceTab = 'local' | 'cloud' | 'preference';

/** 合法的分区值，顺序即 Tab 顺序。 */
const RESOURCE_TABS: ResourceTab[] = ['local', 'cloud', 'preference'];

/** 分区面板 id，供 Tab 的 aria-controls 引用。 */
const TAB_PANEL_IDS: Record<ResourceTab, string> = {
    local: 'resources-panel-local',
    cloud: 'resources-panel-cloud',
    preference: 'resources-panel-preference',
};

/**
 * 拆开下拉项的值：云端选项形如 `openai:<model>`，其余选项就是引擎枚举值本身。
 *
 * @param value 下拉项的值。
 * @returns 引擎名与云端模型；非云端选项的模型为 null。
 */
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
 * 按使用场景拆成三个页内分区：本地资源包（基础/增强/词典）、云端服务（密钥与模型）、
 * 翻译与查词（每项功能使用哪一档资源）。分区之间用标题层级与 Divider 分隔，不再层层套 Card。
 */
const ServiceResourceSetting: React.FC = () => {
    const { t } = useI18nTranslation('settings');

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
    /** 资源状态聚合：三项资源包、本地增强、硬件与回退状态都在这一份里。 */
    const { data: resourceStatus, mutate: refreshResourceStatus } = useSWR(
        'settings/resource-status/detail',
        () => settingsApi.getResourceStatus(),
    );
    /** 可选语义模型状态；失败时静默隐藏，不影响本地增强卡片。 */
    const { data: embeddingStatus, mutate: refreshEmbeddingStatus } = useSWR(
        'settings/embedding-model/status',
        () => settingsApi.getEmbeddingModelStatus(),
        SETTINGS_DETAIL_SWR_OPTIONS,
    );
    const hardware = resourceStatus?.hardware;
    const fallbackState = resourceStatus?.fallback ?? null;
    const localAiStatus = resourceStatus?.localAi ?? null;

    const credentialForm = useForm<ServiceCredentialSettingFormValues>();
    const preferenceForm = useForm<EngineSelectionSettingVO>();

    const {
        ready: credentialReady,
        status: credentialSaveStatus,
        error: credentialSaveError,
        initialize: initializeCredentials,
        flush: flushCredentials,
    } = useAutoSaveSettingsForm<ServiceCredentialSettingFormValues>({
        form: credentialForm,
        detailKey: 'settings/service-credentials/detail',
        onSave: async (values) => {
            // 详情里的 hasKey / keyHint 只是给输入框的提示，不属于保存契约；
            // 密钥字段留空表示沿用已保存的值，不在这里补明文。
            await settingsApi.saveServiceCredentials({
                openai: {
                    ...(values.openai.key ? { key: values.openai.key } : {}),
                    ...(values.openai.clearKey ? { clearKey: true } : {}),
                    endpoint: values.openai.endpoint,
                    apiFormat: values.openai.apiFormat,
                    models: values.openai.models,
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
        status: preferenceSaveStatus,
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
    const subtitleMode = watched.openai?.subtitleTranslationMode;
    const dictionaryEngine = watched.providers?.dictionaryEngine;

    const cacheTargets = {
        subtitle: subtitleEngine !== undefined && subtitleEngine !== 'none' && subtitleEngine !== 'invalid',
        dictionary: dictionaryEngine !== undefined && dictionaryEngine !== 'none' && dictionaryEngine !== 'invalid',
    };
    /** 轻量翻译只出中文，提示替换掉常规说明，避免两行小字并排。 */
    const usesLocalSubtitle = subtitleEngine === 'local-mt' || subtitleEngine === 'local';
    /** 词典选了本地增强但还没有可用模型。 */
    const localDictionaryMissing = dictionaryEngine === 'local'
        && !(localAiStatus?.models.some((model) => model.ready) ?? false);

    // 分区写进 URL（?tab=cloud），刷新或从别处回来仍停在同一分区
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const activeTab: ResourceTab = RESOURCE_TABS.includes(tabParam as ResourceTab)
        ? tabParam as ResourceTab
        : 'local';
    const changeTab = (value: string) => {
        const next = new URLSearchParams(searchParams);
        if (value === 'local') {
            next.delete('tab');
        } else {
            next.set('tab', value);
        }
        setSearchParams(next, { replace: true });
    };

    // 云端密钥测试、本地模型下载/测速、缓存清理等动作统一收进 hook
    const {
        testingOpenAiModel,
        openAiTestResults,
        localAiBusy,
        clearingCache,
        cacheConfirmOpen,
        setCacheConfirmOpen,
        testingModelId,
        testResultsMap,
        changeTranscriptionEngine,
        clearCaches,
        runLocalAiAction,
        downloadLocalAi,
        testLocalAiModel,
        copyText,
        openUrl,
        openFolder,
        testOpenAiModel,
        cancelLocalAiDownload,
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
        // 详情不含明文密钥，表单里对应的编辑字段显式补空：
        // 空串的含义是「沿用已保存的值」，不是「清空」。
        initializeCredentials({
            openai: { ...settings.openai, key: '', clearKey: false },
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
            openai: {
                ...engineSettings.openai,
                subtitleCustomStyle: engineSettings.openai.subtitleCustomStyle.trim()
                    || OPENAI_SUBTITLE_DEFAULT_STYLES.custom,
            },
        });
    }, [engineSettings, initializePreferences]);

    const availableModels = React.useMemo(
        () => settings?.openai.models ?? [],
        [settings],
    );

    const usageByModel = React.useMemo(() => {
        const usage = computeCloudModelUsage({
            sentenceLearningEnabled: watched.openai?.enableSentenceLearning === true,
            subtitleTranslationEngine: watched.providers?.subtitleTranslationEngine ?? '',
            dictionaryEngine: watched.providers?.dictionaryEngine ?? '',
            modelSlots: {
                sentenceLearning: watched.openai?.featureModels?.sentenceLearning ?? '',
                subtitleTranslation: watched.openai?.featureModels?.subtitleTranslation ?? '',
                dictionary: watched.openai?.featureModels?.dictionary ?? '',
            },
        });
        const map = new Map<string, OpenAiModelUsageFeature[]>();
        for (const feature of OPEN_AI_MODEL_USAGE_FEATURES) {
            const model = usage[feature];
            if (!model) continue;
            const list = map.get(model) ?? [];
            list.push(feature);
            map.set(model, list);
        }
        return map;
    }, [watched]);

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
    const sentenceLearningValue = availableModels.length > 0 && watched.openai?.enableSentenceLearning
        ? `openai:${sentenceLearningModel}`
        : 'none';

    const applySentenceLearningValue = (value: string) => {
        const { model } = parseEngineValue(value);
        setValue('openai.enableSentenceLearning', model !== null, { shouldDirty: true });
        setValue('openai.featureModels.sentenceLearning', model ?? '', { shouldDirty: true });
    };

    const enhanceHardwareHint = React.useMemo(() => {
        if (!hardware) return undefined;
        const params = { memory: hardware.totalMemoryGb, cores: hardware.cpuCount };
        if (hardware.totalMemoryGb < ENHANCE_MIN_MEMORY_GB) {
            return t('resources.enhance.hardwareHintLowSpec', params);
        }
        if (hardware.gpuAcceleration === 'none') {
            return t('resources.enhance.hardwareHintNoGpu', params);
        }
        return t('resources.enhance.hardwareHintGpu', {
            ...params,
            gpu: GPU_ACCELERATION_LABELS[hardware.gpuAcceleration],
        });
    }, [hardware, t]);

    const cloudFallback = Boolean(fallbackState?.subtitleTranslation || fallbackState?.dictionary);

    // 下拉选项定义
    const subtitleOptions = React.useMemo(() => [
        ...availableModels.map((m) => ({ value: `openai:${m}`, label: m })),
        ...(subtitleEngine === 'openai' && !!watched.openai?.featureModels?.subtitleTranslation && !availableModels.includes(watched.openai.featureModels.subtitleTranslation)
            ? [{ value: `openai:${watched.openai.featureModels.subtitleTranslation}`, label: watched.openai.featureModels.subtitleTranslation, disabled: true }]
            : []),
        // 历史值 'local-mt' 的 OPUS-MT 轻量管线已移除，后端会把它映射到本地大模型。
        // 不再提供这个选项：选了「基础资源包」实际却走本地大模型，提示与真实能力不符。
        // 旧安装的存储值由 storeSchemaSubtitleEngineLocalMtMigrationV1 改写成 'local'。
        ...(subtitleEngine === 'local-mt'
            ? [{ value: 'local-mt', label: t('resources.preference.engineLocalMtLegacy'), disabled: true }]
            : []),
        { value: 'none', label: t('resources.preference.engineNone') },
    ], [availableModels, subtitleEngine, watched.openai, t]);

    const styleOptions = React.useMemo(() => [
        { value: 'zh', label: t('resources.preference.styleZh') },
        { value: 'simple_en', label: t('resources.preference.styleSimpleEn') },
        { value: 'custom', label: t('resources.preference.styleCustom') },
    ], [t]);

    const dictionaryOptions = React.useMemo(() => [
        ...availableModels.map((m) => ({ value: `openai:${m}`, label: m })),
        ...(watched.providers?.dictionaryEngine === 'openai' && !!watched.openai?.featureModels?.dictionary && !availableModels.includes(watched.openai.featureModels.dictionary)
            ? [{ value: `openai:${watched.openai.featureModels.dictionary}`, label: watched.openai.featureModels.dictionary, disabled: true }]
            : []),
        { value: 'local', label: t('resources.preference.engineLocalAi') },
        { value: 'none', label: t('resources.preference.engineNoSupplement') },
    ], [availableModels, watched.providers?.dictionaryEngine, watched.openai, t]);

    const sentenceOptions = React.useMemo(() => [
        { value: 'none', label: t('resources.preference.engineDisabled') },
        ...availableModels.map((m) => ({ value: `openai:${m}`, label: m })),
    ], [availableModels, t]);

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
                <Tab value="preference" label={t('resources.tabs.preference')} panelId={TAB_PANEL_IDS.preference} />
            </TabList>

            <VStack gap={6} width="100%">
                {credentialSaveStatus === 'error' && credentialSaveError && (
                    <Banner status="error" title={credentialSaveError} />
                )}
                {preferenceSaveStatus === 'error' && preferenceSaveError && (
                    <Banner status="error" title={preferenceSaveError} />
                )}

                {activeTab === 'local' && (
                    <VStack id={TAB_PANEL_IDS.local} role="tabpanel" gap={6} width="100%">
                        <SettingSection
                            title={t('resources.pack.title')}
                            description={t('resources.pack.description')}
                            icon={HardDrive as unknown as IconType}
                        >
                            <ResourcePackCard
                                transcriptionEngine={resourceStatus.transcriptionEngine}
                                ttsStatus={resourceStatus?.tts ?? null}
                                transcriptionStatus={resourceStatus?.transcription ?? null}
                                diarizationStatus={resourceStatus?.diarization ?? null}
                                onRefresh={() => { void refreshResourceStatus(); }}
                                onChangeEngine={(engine) => { void changeTranscriptionEngine(engine); }}
                            />
                        </SettingSection>

                        <Divider variant="subtle" />

                        <SettingSection
                            title={t('resources.enhance.title')}
                            description={t('resources.enhance.description')}
                            icon={Sparkles as unknown as IconType}
                        >
                            <LocalLlmCard
                                status={localAiStatus}
                                busy={localAiBusy}
                                testingModelId={testingModelId}
                                hardwareHint={enhanceHardwareHint}
                                deleteLabel={t('resources.enhance.delete')}
                                deleteConfirmTitle={t('resources.enhance.deleteConfirmTitle')}
                                testResultsMap={testResultsMap}
                                onUseModel={(modelId) => {
                                    const model = localAiStatus?.models.find((item) => item.modelId === modelId);
                                    if (!model) return;
                                    void runLocalAiAction(
                                        model,
                                        () => settingsApi.useLocalAiModel(modelId),
                                        t('serviceCredentials.localAi.useSuccess'),
                                    );
                                }}
                                onTestModel={(modelId) => testLocalAiModel(modelId).catch(() => null)}
                                onDownloadModel={(modelId) => downloadLocalAi(modelId).catch(() => null)}
                                onCancelDownload={cancelLocalAiDownload}
                                onDeleteModel={(modelId) => {
                                    const model = localAiStatus?.models.find((item) => item.modelId === modelId);
                                    if (!model) return Promise.resolve(true);
                                    return runLocalAiAction(
                                        model,
                                        () => settingsApi.deleteLocalAi(modelId),
                                        t('serviceCredentials.localAi.deleteSuccess'),
                                    );
                                }}
                                onOpenFolder={(path) => openFolder(path).catch(() => null)}
                                onCopy={(text) => copyText(text).catch(() => null)}
                                onOpenUrl={(url) => openUrl(url).catch(() => null)}
                            />
                            <EmbeddingModelCard
                                status={embeddingStatus ?? null}
                                onInstalled={() => { void refreshEmbeddingStatus(); }}
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
                            <DictionaryEnhancementCard />
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
                                usageByModel={usageByModel}
                                testingModel={testingOpenAiModel}
                                testResults={openAiTestResults}
                                onTestModel={(model) => testOpenAiModel(model).catch(() => null)}
                                onModelRemoved={forgetOpenAiTestResult}
                                onCopy={(text) => copyText(text).catch(() => null)}
                                onOpenUrl={(url) => openUrl(url).catch(() => null)}
                                disabled={credentialSaveStatus === 'saving'}
                            />
                        </SettingSection>
                    </VStack>
                )}

                {activeTab === 'preference' && (
                    <VStack id={TAB_PANEL_IDS.preference} role="tabpanel" gap={6} width="100%">
                        <SettingSection
                            title={t('resources.preference.title')}
                            description={t('resources.preference.description')}
                            icon={Languages as unknown as IconType}
                        >
                            <SettingField
                                title={t('resources.preference.subtitleLabel')}
                                testId={SETTING_ROW_TESTIDS.subtitleTranslation}
                                description={usesLocalSubtitle
                                    ? t('resources.preference.localMtZhOnlyHint')
                                    : t('resources.preference.subtitleDesc')}
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

                            <VStack gap={3} width="100%">
                                <SettingField
                                    title={t('resources.preference.styleLabel')}
                                    testId={SETTING_ROW_TESTIDS.subtitleStyle}
                                    description={t('resources.preference.styleDesc')}
                                >
                                    <Selector
                                        label={t('resources.preference.styleLabel')}
                                        isLabelHidden
                                        value={watched.openai?.subtitleTranslationMode}
                                        onChange={(val) => {
                                            setValue('openai.subtitleTranslationMode', val as 'zh' | 'simple_en' | 'custom', { shouldDirty: true });
                                        }}
                                        options={styleOptions}
                                        size="sm"
                                        width={224}
                                    />
                                </SettingField>

                                {subtitleMode === 'custom' && (
                                    <TextArea
                                        data-testid="custom-subtitle-style"
                                        label={t('resources.preference.styleLabel')}
                                        isLabelHidden
                                        value={watched.openai?.subtitleCustomStyle ?? ''}
                                        onChange={(val) => {
                                            setValue('openai.subtitleCustomStyle', val, { shouldDirty: true });
                                        }}
                                        placeholder={t('resources.preference.stylePlaceholder')}
                                        rows={4}
                                    />
                                )}
                            </VStack>

                            <Divider variant="subtle" />

                            <SettingField
                                title={t('resources.preference.dictionaryLabel')}
                                testId={SETTING_ROW_TESTIDS.dictionary}
                                description={localDictionaryMissing
                                    ? t('resources.preference.notReadyHint')
                                    : t('resources.preference.dictionaryDesc')}
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
                                            cancelLabel={t('common.cancel', { defaultValue: '取消' })}
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
                    </VStack>
                )}
            </VStack>
        </SettingsPageShell>
    );
};

export default ServiceResourceSetting;
