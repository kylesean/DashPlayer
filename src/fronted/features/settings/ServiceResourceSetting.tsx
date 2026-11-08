import React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import useSWR from 'swr';
import toast from 'react-hot-toast';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import {
    AlertTriangle,
    BookA,
    Captions,
    Cloud,
    Eraser,
    HardDrive,
    Languages,
    Settings2,
    Sparkles,
    Volume2,
} from 'lucide-react';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon, type IconType } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { VStack } from '@astryxdesign/core/VStack';

import SettingsPageShell from '@/fronted/features/settings/components/form/SettingsPageShell';
import { SettingCard, SettingRow, SettingsLoadingSkeleton } from '@/fronted/features/settings/components/form';
import { ResourcePackCard } from '@/fronted/features/settings/components/ResourcePackCard';
import { LocalLlmCard } from '@/fronted/features/settings/components/LocalLlmCard';
import { OpenAiCredentialCard } from '@/fronted/features/settings/components/OpenAiCredentialCard';
import { SETTINGS_DETAIL_SWR_OPTIONS, settingsApi } from '@/fronted/features/settings/settingsApi';
import { useAutoSaveSettingsForm } from '@/fronted/features/settings/useAutoSaveSettingsForm';
import { OPENAI_SUBTITLE_DEFAULT_STYLES } from '@/common/constants/openaiSubtitlePrompts';
import { subscribeLocalAiDownloadProgress } from '@/fronted/features/settings/settingsEvents';
import type { LocalAiModelStatus } from '@/common/contracts/local-ai';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';
import type { EngineSelectionSettingVO } from '@/common/types/vo/engine-selection-setting-vo';
import type { ServiceCredentialSettingDetailVO } from '@/common/types/vo/service-credentials-setting-vo';
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

/** 卡片头右侧的能力图标。 */
interface CapabilityIcon {
    /** 图标组件。 */
    icon: IconType;
    /** 能力名文案键。 */
    labelKey: string;
    /** 是否能在下方「翻译与查词偏好」里切换（决定悬停提示文案）。 */
    configurable: boolean;
}

const CAPABILITY_TRANSLATION: CapabilityIcon = { icon: Languages as unknown as IconType, labelKey: 'resources.capability.translation', configurable: true };
const CAPABILITY_DICTIONARY: CapabilityIcon = { icon: BookA as unknown as IconType, labelKey: 'resources.capability.dictionary', configurable: true };
const CAPABILITY_SENTENCE: CapabilityIcon = { icon: Sparkles as unknown as IconType, labelKey: 'resources.capability.sentence', configurable: true };
const CAPABILITY_TRANSCRIPTION: CapabilityIcon = { icon: Captions as unknown as IconType, labelKey: 'resources.capability.transcription', configurable: false };
const CAPABILITY_TTS: CapabilityIcon = { icon: Volume2 as unknown as IconType, labelKey: 'resources.capability.tts', configurable: false };

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
 * 把“服务与模型”与“功能设置”两页合并成四块：本地基础资源包（发音/字幕识别/轻量翻译三合一）、
 * 本地增强（可选）、云端服务（可选）、翻译与查词偏好。
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
    const hardware = resourceStatus?.hardware;
    const fallbackState = resourceStatus?.fallback ?? null;
    const localAiStatus = resourceStatus?.localAi ?? null;

    const credentialForm = useForm<ServiceCredentialSettingDetailVO>();
    const preferenceForm = useForm<EngineSelectionSettingVO>();

    const {
        ready: credentialReady,
        status: credentialSaveStatus,
        error: credentialSaveError,
        initialize: initializeCredentials,
        flush: flushCredentials,
    } = useAutoSaveSettingsForm<ServiceCredentialSettingDetailVO>({
        form: credentialForm,
        detailKey: 'settings/service-credentials/detail',
        onSave: async (values) => {
            await settingsApi.saveServiceCredentials(values);
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
    const sentenceLearningEnabled = watched.openai?.enableSentenceLearning === true;

    const cacheTargets = {
        subtitle: subtitleEngine !== undefined && subtitleEngine !== 'none' && subtitleEngine !== 'invalid',
        dictionary: dictionaryEngine !== undefined && dictionaryEngine !== 'none' && dictionaryEngine !== 'invalid',
    };

    // 云端密钥的连通性测试
    const [testingOpenAiModel, setTestingOpenAiModel] = React.useState<string | null>(null);
    const [openAiTestResults, setOpenAiTestResults] = React.useState<Record<string, { success: boolean; message: string } | null>>({});

    // 本地增强模型
    const [localAiBusy, setLocalAiBusy] = React.useState(false);
    const [clearingCache, setClearingCache] = React.useState(false);
    const [testingModelId, setTestingModelId] = React.useState<string | null>(null);
    const [testResultsMap, setTestResultsMap] = React.useState<Record<string, {
        success: boolean;
        warmSec: string;
        tps: string;
        errorMessage?: string;
    } | null>>({});

    React.useEffect(() => {
        if (!settings) return;
        initializeCredentials(settings);
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

    const changeTranscriptionEngine = async (engine: TranscriptionEngine) => {
        try {
            await settingsApi.saveTranscriptionEngine(engine);
            await refreshResourceStatus();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    const clearCaches = async () => {
        setClearingCache(true);
        try {
            const [subtitle, dictionary] = await Promise.all([
                cacheTargets.subtitle ? settingsApi.clearSubtitleTranslationCache() : { deleted: 0 },
                cacheTargets.dictionary ? settingsApi.clearDictionaryCache() : { deleted: 0 },
            ]);
            toast.success(t('resources.preference.clearCacheDone', {
                count: subtitle.deleted + dictionary.deleted,
            }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setClearingCache(false);
        }
    };

    const localAiDisplayName = (model: LocalAiModelStatus): string =>
        model.custom ? model.name : t('serviceCredentials.localAi.builtinModelName');

    const runLocalAiAction = async (model: LocalAiModelStatus, action: () => Promise<unknown>, successMessage: string) => {
        setLocalAiBusy(true);
        try {
            await action();
            toast.success(`${localAiDisplayName(model)}: ${successMessage}`);
        } catch (error) {
            toast.error(`${localAiDisplayName(model)}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setLocalAiBusy(false);
            await refreshResourceStatus();
        }
    };

    const downloadLocalAi = async (modelId: string) => {
        const model = localAiStatus?.models.find((item) => item.modelId === modelId);
        void refreshResourceStatus((current) => current ? {
            ...current,
            localAi: {
                ...current.localAi,
                models: current.localAi.models.map((item) => item.modelId === modelId ? { ...item, phase: 'downloading' } : item),
            },
        } : current, { revalidate: false });
        try {
            await settingsApi.downloadLocalAi(modelId);
            toast.success(t('common.downloadDone'));
        } catch (error) {
            const prefix = model ? `${localAiDisplayName(model)}: ` : '';
            toast.error(`${prefix}${error instanceof Error ? error.message : String(error)}`);
        } finally {
            await refreshResourceStatus();
        }
    };

    const testLocalAiModel = async (modelId: string) => {
        setTestingModelId(modelId);
        try {
            const result = await settingsApi.speedTestLocalAi(modelId);
            setTestResultsMap((prev) => ({
                ...prev,
                [modelId]: {
                    success: true,
                    warmSec: (result.warmMs / 1000).toFixed(1),
                    tps: result.tokensPerSecond === null ? '—' : result.tokensPerSecond.toFixed(1),
                },
            }));
        } catch (error) {
            setTestResultsMap((prev) => ({
                ...prev,
                [modelId]: {
                    success: false,
                    warmSec: '—',
                    tps: '—',
                    errorMessage: error instanceof Error ? error.message : String(error),
                },
            }));
        } finally {
            setTestingModelId(null);
            await refreshResourceStatus();
        }
    };

    const copyText = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('common.copied'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    const openUrl = async (url: string) => {
        try {
            await settingsApi.openUrl(url);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    const openFolder = async (path?: string) => {
        if (!path) return;
        try {
            await settingsApi.openFolderForFile(path);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    const testOpenAiModel = async (model: string) => {
        try {
            await flushCredentials();
        } catch (flushError) {
            toast.error(`${t('common.saveFailed')}\n${flushError instanceof Error ? flushError.message : String(flushError)}`);
            return;
        }

        setTestingOpenAiModel(model);
        setOpenAiTestResults((prev) => ({ ...prev, [model]: null }));
        try {
            const result = await settingsApi.testOpenAi(model);
            setOpenAiTestResults((prev) => ({ ...prev, [model]: result }));
        } catch (error) {
            setOpenAiTestResults((prev) => ({
                ...prev,
                [model]: { success: false, message: error instanceof Error ? error.message : String(error) },
            }));
        } finally {
            setTestingOpenAiModel(null);
        }
    };

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

    const renderCapabilityIcons = (
        items: { cap: CapabilityIcon; active: boolean }[],
        showFallback = false,
    ) => (
        <HStack gap={1.5} vAlign="center">
            {items.map(({ cap, active }) => {
                const name = t(cap.labelKey);
                const tooltipText = cap.configurable
                    ? t('resources.capability.configurableHint', {
                        name,
                        card: t('resources.preference.title'),
                    })
                    : name;
                return (
                    <Tooltip key={cap.labelKey} content={tooltipText}>
                        <Icon
                            icon={cap.icon}
                            size="xsm"
                            color={active ? 'primary' : 'disabled'}
                        />
                    </Tooltip>
                );
            })}
            {showFallback && cloudFallback && (
                <Tooltip content={t('resources.capability.fallbackHint')}>
                    <Icon
                        icon={AlertTriangle as unknown as IconType}
                        size="xsm"
                    />
                </Tooltip>
            )}
        </HStack>
    );

    // 下拉选项定义
    const subtitleOptions = React.useMemo(() => [
        ...availableModels.map((m) => ({ value: `openai:${m}`, label: m })),
        ...(subtitleEngine === 'openai' && !!watched.openai?.featureModels?.subtitleTranslation && !availableModels.includes(watched.openai.featureModels.subtitleTranslation)
            ? [{ value: `openai:${watched.openai.featureModels.subtitleTranslation}`, label: watched.openai.featureModels.subtitleTranslation, disabled: true }]
            : []),
        { value: 'local', label: t('resources.preference.engineLocalAi') },
        { value: 'none', label: t('resources.preference.engineNone') },
    ], [availableModels, subtitleEngine, watched.openai?.featureModels?.subtitleTranslation, t]);

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
    ], [availableModels, watched.providers?.dictionaryEngine, watched.openai?.featureModels?.dictionary, t]);

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
            <VStack gap={6} maxWidth={768}>
                {credentialSaveStatus === 'error' && credentialSaveError && (
                    <Banner
                        status="error"
                        title={credentialSaveError}
                    />
                )}
                {preferenceSaveStatus === 'error' && preferenceSaveError && (
                    <Banner
                        status="error"
                        title={preferenceSaveError}
                    />
                )}

                {/* ① 本地基础资源包 */}
                <SettingCard
                    title={t('resources.pack.title')}
                    description={t('resources.pack.description')}
                    icon={HardDrive as unknown as IconType}
                    headerAction={renderCapabilityIcons([
                        { cap: CAPABILITY_TTS, active: true },
                        { cap: CAPABILITY_TRANSCRIPTION, active: true },
                    ])}
                >
                    <ResourcePackCard
                        transcriptionEngine={resourceStatus.transcriptionEngine}
                        ttsStatus={resourceStatus?.tts ?? null}
                        transcriptionStatus={resourceStatus?.transcription ?? null}
                        onRefresh={() => { void refreshResourceStatus(); }}
                        onChangeEngine={(engine) => { void changeTranscriptionEngine(engine); }}
                    />
                </SettingCard>

                {/* ② 本地增强资源包 */}
                <SettingCard
                    title={t('resources.enhance.title')}
                    description={t('resources.enhance.description')}
                    icon={Sparkles as unknown as IconType}
                    headerAction={renderCapabilityIcons([
                        { cap: CAPABILITY_TRANSLATION, active: subtitleEngine === 'local' },
                        { cap: CAPABILITY_DICTIONARY, active: dictionaryEngine === 'local' },
                    ])}
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
                        onCancelDownload={() => {
                            setLocalAiBusy(true);
                            settingsApi.cancelLocalAiDownload()
                                .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
                                .finally(() => {
                                    setLocalAiBusy(false);
                                    void refreshResourceStatus();
                                });
                        }}
                        onDeleteModel={(modelId) => {
                            const model = localAiStatus?.models.find((item) => item.modelId === modelId);
                            if (!model) return;
                            void runLocalAiAction(
                                model,
                                () => settingsApi.deleteLocalAi(modelId),
                                t('serviceCredentials.localAi.deleteSuccess'),
                            );
                        }}
                        onOpenFolder={(path) => openFolder(path).catch(() => null)}
                        onCopy={(text) => copyText(text).catch(() => null)}
                        onOpenUrl={(url) => openUrl(url).catch(() => null)}
                    />
                </SettingCard>

                {/* ③ 云端服务 */}
                <SettingCard
                    title={t('resources.cloud.title')}
                    description={t('resources.cloud.description')}
                    icon={Cloud as unknown as IconType}
                    headerAction={renderCapabilityIcons([
                        { cap: CAPABILITY_TRANSLATION, active: subtitleEngine === 'openai' },
                        { cap: CAPABILITY_DICTIONARY, active: dictionaryEngine === 'openai' },
                        { cap: CAPABILITY_SENTENCE, active: sentenceLearningEnabled },
                    ], true)}
                >
                    <OpenAiCredentialCard
                        form={credentialForm}
                        usageByModel={usageByModel}
                        testingModel={testingOpenAiModel}
                        testResults={openAiTestResults}
                        onTestModel={(model) => testOpenAiModel(model).catch(() => null)}
                        onModelRemoved={(model) => setOpenAiTestResults((prev) => {
                            const next = { ...prev };
                            delete next[model];
                            return next;
                        })}
                        onCopy={(text) => copyText(text).catch(() => null)}
                        onOpenUrl={(url) => openUrl(url).catch(() => null)}
                        disabled={credentialSaveStatus === 'saving'}
                    />
                </SettingCard>

                {/* ④ 翻译与查词偏好 */}
                <SettingCard
                    title={t('resources.preference.title')}
                    description={t('resources.preference.description')}
                    icon={Languages as unknown as IconType}
                >
                    <SettingRow
                        title={t('resources.preference.subtitleLabel')}
                        description={t('resources.preference.subtitleDesc')}
                        icon={Languages as unknown as IconType}
                    >
                        <VStack gap={1} hAlign="end">
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
                            {subtitleEngine === 'local' && !(localAiStatus?.models.some((model) => model.ready) ?? false) && (
                                <Text size="2xs" color="disabled">{t('resources.preference.notReadyHint')}</Text>
                            )}
                        </VStack>
                    </SettingRow>

                    {/* 翻译风格 */}
                    <Card variant="transparent" padding={4}>
                        <VStack gap={3}>
                            <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
                                <HStack gap={2} vAlign="center">
                                    <Icon icon={Settings2 as unknown as IconType} size="sm" />
                                    <Text size="sm" weight="medium">{t('resources.preference.styleLabel')}</Text>
                                </HStack>
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
                            </HStack>

                            <TextArea
                                label={t('resources.preference.styleLabel')}
                                isLabelHidden
                                value={subtitleMode === 'custom'
                                    ? (watched.openai?.subtitleCustomStyle ?? '')
                                    : (OPENAI_SUBTITLE_DEFAULT_STYLES[subtitleMode === 'simple_en' ? 'simple_en' : 'zh'] ?? '')}
                                onChange={(val) => {
                                    setValue('openai.subtitleCustomStyle', val, { shouldDirty: true });
                                }}
                                isReadOnly={subtitleMode !== 'custom'}
                                placeholder={t('resources.preference.stylePlaceholder')}
                                rows={4}
                            />
                        </VStack>
                    </Card>

                    <SettingRow
                        title={t('resources.preference.dictionaryLabel')}
                        description={t('resources.preference.dictionaryDesc')}
                        icon={Languages as unknown as IconType}
                    >
                        <VStack gap={1} hAlign="end">
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
                            {watched.providers?.dictionaryEngine === 'local'
                                && !(localAiStatus?.models.some((model) => model.ready) ?? false) && (
                                <Text size="2xs" color="disabled">{t('resources.preference.notReadyHint')}</Text>
                            )}
                        </VStack>
                    </SettingRow>

                    <SettingRow
                        title={t('resources.preference.sentenceLabel')}
                        description={t('resources.preference.sentenceDesc')}
                        icon={Settings2 as unknown as IconType}
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
                    </SettingRow>

                    {(cacheTargets.subtitle || cacheTargets.dictionary) && (
                        <SettingRow
                            title={t('resources.preference.cacheLabel')}
                            description={t('resources.preference.cacheDesc')}
                            icon={Eraser as unknown as IconType}
                        >
                            <Button
                                label={t('resources.preference.clearCache')}
                                size="sm"
                                variant="secondary"
                                isLoading={clearingCache}
                                icon={<Icon icon={Eraser as unknown as IconType} size="sm" />}
                                onClick={() => { void clearCaches(); }}
                            />
                        </SettingRow>
                    )}
                </SettingCard>
            </VStack>
        </SettingsPageShell>
    );
};

export default ServiceResourceSetting;
