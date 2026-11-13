import React from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { englishDictionaryApi } from '@/fronted/features/settings/englishDictionaryApi';
import { getSystemInfo, markOnboardingCompleted, type SystemInfo } from '@/fronted/features/onboarding/onboardingApi';
import {
    subscribeArchiveDownloadProgress,
    subscribeEmbeddingDownloadProgress,
} from '@/fronted/features/settings/settingsEvents';
import {
    CLOUD_AI_PROVIDER_PRESETS,
    isLocalLlmEndpoint,
} from '@/common/constants/cloud-ai-provider-presets';
import { CURRENT_ONBOARDING_VERSION } from '@/common/constants/onboarding';
import { LOCAL_EMBEDDING_MODEL, type LocalEmbeddingStatus } from '@/common/contracts/local-ai';
import type { EnglishDictionaryStatusVO } from '@/common/contracts/english-dictionary';
import { DpTaskState } from '@/common/contracts/dp-task';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';
import type { ModelDownloadPhase } from '@/common/contracts/model-download-phase';
import { evaluateHardwareProfile, type OnboardingTier } from '@/common/utils/hardware-profile';
import useDpTaskCenter from '@/fronted/app/stores/dpTaskStore';
import {
    isFinishing,
    transitionOnboardingScreen,
    type OnboardingEvent,
    type OnboardingScreen,
} from '@/fronted/features/onboarding/lib/onboarding-screen';

/** 离线资源包内资源项的标识；数组顺序即下载顺序（先小后大）。 */
export type BundleItemKey =
    | 'dictionaryEnhancement'
    | 'embedding'
    | 'tts'
    | 'transcription';

/** 引导页方案档位：`standard` 全本地推荐 / `light` 轻量核心 / `custom` 自定义。 */
export type BundleTierChoice = OnboardingTier | 'custom';

/** 网速的指数滑动平均系数，抑制进度事件抖动。 */
const SPEED_SMOOTHING = 0.3;

/** 进度与网速刷新到 UI 的最小间隔（毫秒）。 */
const PROGRESS_RENDER_INTERVAL_MS = 400;

/** 近似包体积常量，供尚未拉到状态前的总量估算使用。 */
const ESTIMATED_BYTES = {
    tts: 335_544_320,
    whisperCpp: 566_231_040,
    sherpaOnnx: 487_587_840,
    dictionaryEnhancement: 16_777_216,
    embedding: LOCAL_EMBEDDING_MODEL.bytes,
} as const;

/** 下载完成后的收尾阶段文案；未收录的阶段回落到通用下载提示。 */
const PHASE_LABEL_KEYS: Partial<Record<ModelDownloadPhase, string>> = {
    verifying: 'steps.download.verifying',
    extracting: 'steps.download.extracting',
    installing: 'steps.download.installing',
};

/** 资源包内单项资源的展示信息、选中状态与下载动作。 */
export interface BundleEntry {
    key: BundleItemKey;
    title: string;
    description: string;
    sizeLabel: string;
    bytes: number;
    checked: boolean;
    ready: boolean;
    optional: boolean;
    /** 有序候选下载地址（首个为主源，其余为备用镜像）。 */
    urls: readonly string[] | null;
    /** 手动下载后应保存到的路径。 */
    targetPath: string | null;
}

function formatGigabytesOrMegabytes(bytes: number): string {
    if (bytes <= 0) return '0 MB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 0.95) {
        return `~${gb.toFixed(1)} GB`;
    }
    return `~${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

function tierSelectionMap(tier: OnboardingTier): Record<BundleItemKey, boolean> {
    if (tier === 'standard') {
        return {
            dictionaryEnhancement: true,
            embedding: true,
            tts: true,
            transcription: true,
        };
    }
    return {
        dictionaryEnhancement: true,
        embedding: false,
        tts: true,
        transcription: true,
    };
}

/** 并发拉取硬件规格、存储状态及全部核心/增强离线资源状态。 */
async function fetchOnboardingStatuses() {
    const [
        hardware,
        storageStatus,
        tts,
        whisperCpp,
        parakeet,
        embedding,
        dictionaryEnhancement,
    ] = await Promise.all([
        getSystemInfo?.().catch(() => null) ?? Promise.resolve(null),
        settingsApi.getStorageStatus?.().catch(() => null) ?? Promise.resolve(null),
        settingsApi.getSherpaTtsModelStatus?.().catch(() => null) ?? Promise.resolve(null),
        settingsApi.getWhisperCppModelStatus?.().catch(() => null) ?? Promise.resolve(null),
        settingsApi.getParakeetModelStatus?.().catch(() => null) ?? Promise.resolve(null),
        settingsApi.getEmbeddingModelStatus?.().catch(() => null) ?? Promise.resolve(null),
        englishDictionaryApi.status?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    return {
        hardware,
        storageStatus,
        tts,
        whisperCpp,
        parakeet,
        embedding,
        dictionaryEnhancement,
    };
}

/**
 * 引导页的资源编排：硬件自检、档位匹配、按需队列下载、快速云端配置与初始路由落地。
 */
export function useOnboardingBundle() {
    const { t } = useI18nTranslation('onboarding');

    const [screen, setScreen] = React.useState<OnboardingScreen>('storage');
    const finishing = isFinishing(screen);

    const dispatch = React.useCallback((event: OnboardingEvent): void => {
        setScreen((current) => transitionOnboardingScreen(current, event) ?? current);
    }, []);

    // 存储位置 & 硬件信息
    const [hardware, setHardware] = React.useState<SystemInfo | null>(null);
    const [storagePath, setStoragePath] = React.useState('');
    const [storageAvailable, setStorageAvailable] = React.useState(true);
    const [choosingStorage, setChoosingStorage] = React.useState(false);

    // 各离线资源状态
    const [ttsStatus, setTtsStatus] = React.useState<ModelInstallationStatusVO | null>(null);
    const [whisperStatus, setWhisperStatus] = React.useState<ModelInstallationStatusVO | null>(null);
    const [parakeetStatus, setParakeetStatus] = React.useState<ModelInstallationStatusVO | null>(null);
    const [embeddingStatus, setEmbeddingStatus] = React.useState<LocalEmbeddingStatus | null>(null);
    const [dictionaryStatus, setDictionaryStatus] = React.useState<EnglishDictionaryStatusVO | null>(null);

    const advice = React.useMemo(() => evaluateHardwareProfile(hardware), [hardware]);

    // 用户对档位与可选组件的偏好
    const userEditedSelectionRef = React.useRef(false);
    const [selectedTier, setSelectedTier] = React.useState<BundleTierChoice>('standard');
    const [selectedItems, setSelectedItems] = React.useState<Record<BundleItemKey, boolean>>(() =>
        tierSelectionMap('standard'),
    );

    // 可选云端快速配置状态
    const [cloudQuickOpen, setCloudQuickOpen] = React.useState(false);
    const [cloudPresetId, setCloudPresetId] = React.useState('deepseek');
    const [cloudApiKey, setCloudApiKey] = React.useState('');
    const [cloudModelId, setCloudModelId] = React.useState('');
    const [cloudSaving, setCloudSaving] = React.useState(false);
    const [cloudSavedProvider, setCloudSavedProvider] = React.useState<string | null>(null);

    // 下载过程状态
    const [downloadingBundle, setDownloadingBundle] = React.useState(false);
    const downloadingBundleRef = React.useRef(false);
    const finishingRef = React.useRef(false);
    const choosingStorageRef = React.useRef(false);
    const [activeItem, setActiveItem] = React.useState<BundleItemKey | null>(null);
    const activeItemRef = React.useRef<BundleItemKey | null>(null);
    const activeDictTaskIdRef = React.useRef<number | null>(null);
    const [activePhase, setActivePhase] = React.useState<ModelDownloadPhase | null>(null);
    const [packProgress, setPackProgress] = React.useState({
        completed: 0,
        count: 0,
        completedBytes: 0,
        totalBytes: 0,
    });
    const [live, setLive] = React.useState({ percent: 0, downloaded: 0, total: 0, speed: 0 });
    const liveRef = React.useRef({ percent: 0, downloaded: 0, total: 0, speed: 0 });
    const [bundleError, setBundleError] = React.useState<string | null>(null);
    const cancelRequestedRef = React.useRef(false);
    const speedSampleRef = React.useRef<{ at: number; downloaded: number } | null>(null);

    const applyStatuses = React.useCallback((result: Awaited<ReturnType<typeof fetchOnboardingStatuses>>) => {
        if (result.hardware) {
            setHardware(result.hardware);
            if (!userEditedSelectionRef.current) {
                const nextAdvice = evaluateHardwareProfile(result.hardware);
                setSelectedTier(nextAdvice.recommendedOnboardingTier);
                setSelectedItems(tierSelectionMap(nextAdvice.recommendedOnboardingTier));
            }
        }
        if (result.storageStatus) {
            setStoragePath(result.storageStatus.resolvedPath);
            setStorageAvailable(result.storageStatus.available);
        }
        if (result.tts) setTtsStatus(result.tts);
        if (result.whisperCpp) setWhisperStatus(result.whisperCpp);
        if (result.parakeet) setParakeetStatus(result.parakeet);
        if (result.embedding) setEmbeddingStatus(result.embedding);
        if (result.dictionaryEnhancement) setDictionaryStatus(result.dictionaryEnhancement);
    }, []);

    const refreshAllStatuses = React.useCallback(async () => {
        try {
            const result = await fetchOnboardingStatuses();
            applyStatuses(result);
        } catch {
            // 状态拉取失败不阻断引导
        }
    }, [applyStatuses]);

    React.useEffect(() => {
        let cancelled = false;
        const loadStatuses = () => {
            void fetchOnboardingStatuses().then((result) => {
                if (!cancelled) {
                    applyStatuses(result);
                }
            }).catch(() => undefined);
        };
        loadStatuses();
        const refreshOnFocus = () => { loadStatuses(); };
        const refreshOnVisible = () => { if (!document.hidden) loadStatuses(); };
        window.addEventListener('focus', refreshOnFocus);
        document.addEventListener('visibilitychange', refreshOnVisible);
        return () => {
            cancelled = true;
            window.removeEventListener('focus', refreshOnFocus);
            document.removeEventListener('visibilitychange', refreshOnVisible);
        };
    }, [applyStatuses]);

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

    React.useEffect(() => {
        if (!downloadingBundle) return undefined;
        const timer = window.setInterval(() => {
            setLive({ ...liveRef.current });
        }, PROGRESS_RENDER_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [downloadingBundle]);

    React.useEffect(() => {
        const unsubArchive = subscribeArchiveDownloadProgress((detail) => {
            if (activeItemRef.current !== 'tts' && activeItemRef.current !== 'transcription') {
                return;
            }
            setActivePhase(detail.phase);
            if (detail.phase === 'downloading' && detail.total > 0) {
                trackProgress(detail.downloaded, detail.total);
            }
            if (detail.phase === 'idle') void refreshAllStatuses();
        });
        const unsubEmbedding = subscribeEmbeddingDownloadProgress((detail) => {
            if (activeItemRef.current !== 'embedding') return;
            setActivePhase(detail.phase);
            if (detail.phase === 'downloading' && detail.total > 0) {
                trackProgress(detail.downloaded, detail.total);
            }
            if (detail.phase === 'idle') void refreshAllStatuses();
        });
        return () => {
            unsubArchive();
            unsubEmbedding();
        };
    }, [refreshAllStatuses, trackProgress]);

    const selectTier = React.useCallback((tier: BundleTierChoice) => {
        userEditedSelectionRef.current = true;
        setSelectedTier(tier);
        if (tier !== 'custom') {
            setSelectedItems(tierSelectionMap(tier));
        }
    }, []);

    const toggleItem = React.useCallback((key: BundleItemKey) => {
        userEditedSelectionRef.current = true;
        setSelectedTier('custom');
        setSelectedItems((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const selectCloudPreset = React.useCallback((presetId: string) => {
        setCloudPresetId(presetId);
    }, []);

    /** 引导内快速保存云端或本地推理服务凭据（可选）。 */
    const saveQuickCloudSetup = React.useCallback(async () => {
        const preset = CLOUD_AI_PROVIDER_PRESETS.find((item) => item.id === cloudPresetId)
            ?? CLOUD_AI_PROVIDER_PRESETS[0];
        const trimmedKey = cloudApiKey.trim();
        const trimmedModel = cloudModelId.trim();
        const needsKey = !isLocalLlmEndpoint(preset.endpoint);
        if ((needsKey && !trimmedKey) || !trimmedModel) {
            return;
        }
        setCloudSaving(true);
        try {
            const current = await settingsApi.getServiceCredentials();
            const mergedModels = Array.from(new Set([...current.openai.models, trimmedModel]));
            await settingsApi.saveServiceCredentials({
                openai: {
                    key: trimmedKey,
                    endpoint: preset.endpoint,
                    apiFormat: preset.apiFormat,
                    models: mergedModels,
                },
                tencent: {},
            });
            setCloudSavedProvider(preset.name);
            toast.success(t('steps.download.cloud.savedBadge', { provider: preset.name }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setCloudSaving(false);
        }
    }, [cloudApiKey, cloudModelId, cloudPresetId, t]);

    const copyText = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('copied'));
        } catch {
            toast.error(t('copyFailed'));
        }
    };

    const openUrl = async (url: string) => {
        try {
            await settingsApi.openUrl(url);
        } catch {
            toast.error(t('openUrlFailed'));
        }
    };

    const openFolder = async (targetPath: string) => {
        try {
            await settingsApi.openFolderForFile(targetPath);
        } catch {
            toast.error(t('openFolderFailed'));
        }
    };

    const handleChooseStorage = async () => {
        if (choosingStorageRef.current || downloadingBundleRef.current) return;
        choosingStorageRef.current = true;
        setChoosingStorage(true);
        try {
            const picked = await settingsApi.selectStorageFolder({ createDirectory: true });
            if (picked.length === 0) {
                return;
            }
            await settingsApi.saveStorage(picked[0]);
            await refreshAllStatuses();
            toast.success(t('steps.storage.saved'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            choosingStorageRef.current = false;
            setChoosingStorage(false);
        }
    };

    const usesWhisperCpp = advice.recommendedTranscriptionEngine === 'whisper-cpp';
    const activeTranscriptionStatus = usesWhisperCpp ? whisperStatus : parakeetStatus;

    /** 安装 WordNet 3.1 英英词典并等待后台任务落盘完成。 */
    const runDictionaryEnhancementInstall = React.useCallback((): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const settleResolve = () => {
                if (!settled) {
                    settled = true;
                    activeDictTaskIdRef.current = null;
                    resolve();
                }
            };
            const settleReject = (reason: unknown) => {
                if (!settled) {
                    settled = true;
                    activeDictTaskIdRef.current = null;
                    reject(reason instanceof Error ? reason : new Error(String(reason)));
                }
            };
            void useDpTaskCenter.getState().register(
                () => englishDictionaryApi.install(),
                {
                    onUpdated: (task) => {
                        if (task.status === DpTaskState.FAILED) {
                            settleReject(task.progress || task.result || 'WordNet 词典安装失败');
                        } else if (task.status === DpTaskState.CANCELLED) {
                            settleReject('WordNet 词典安装已取消');
                        }
                    },
                    onFinish: () => {
                        void refreshAllStatuses();
                        settleResolve();
                    },
                },
            ).then((id) => {
                activeDictTaskIdRef.current = id;
            }).catch(settleReject);
        });
    }, [refreshAllStatuses]);

    /** 全部引导资源项：按从轻量到大型的顺序展示与下载。 */
    const allBundleEntries: BundleEntry[] = React.useMemo(() => [
        {
            key: 'dictionaryEnhancement',
            title: t('steps.download.items.dictionaryEnhancement.title'),
            description: t('steps.download.items.dictionaryEnhancement.desc'),
            sizeLabel: t('steps.download.items.dictionaryEnhancement.size'),
            bytes: ESTIMATED_BYTES.dictionaryEnhancement,
            checked: selectedItems.dictionaryEnhancement,
            ready: dictionaryStatus?.installed ?? false,
            optional: true,
            urls: null,
            targetPath: null,
        },
        {
            key: 'tts',
            title: t('steps.download.items.tts.title'),
            description: t('steps.download.items.tts.desc'),
            sizeLabel: t('steps.download.items.tts.size'),
            bytes: ESTIMATED_BYTES.tts,
            checked: selectedItems.tts,
            ready: ttsStatus?.ready ?? false,
            optional: false,
            urls: ttsStatus?.downloadUrls ?? null,
            targetPath: ttsStatus?.archivePath ?? null,
        },
        {
            key: 'transcription',
            title: t('steps.download.items.transcription.title', {
                engine: usesWhisperCpp ? t('hardware.asrWhisperCpp') : t('hardware.asrSherpaOnnx'),
            }),
            description: usesWhisperCpp
                ? t('steps.download.items.transcription.descWhisper')
                : t('steps.download.items.transcription.descSherpa'),
            sizeLabel: usesWhisperCpp
                ? t('steps.download.items.transcription.sizeWhisper')
                : t('steps.download.items.transcription.sizeSherpa'),
            bytes: usesWhisperCpp ? ESTIMATED_BYTES.whisperCpp : ESTIMATED_BYTES.sherpaOnnx,
            checked: selectedItems.transcription,
            ready: activeTranscriptionStatus?.ready ?? false,
            optional: false,
            urls: activeTranscriptionStatus?.downloadUrls ?? null,
            targetPath: activeTranscriptionStatus?.archivePath ?? null,
        },
        {
            key: 'embedding',
            title: t('steps.download.items.embedding.title'),
            description: t('steps.download.items.embedding.desc'),
            sizeLabel: t('steps.download.items.embedding.size'),
            bytes: embeddingStatus?.bytes ?? ESTIMATED_BYTES.embedding,
            checked: selectedItems.embedding,
            ready: embeddingStatus?.ready ?? false,
            optional: true,
            urls: embeddingStatus?.downloadUrls ?? [...LOCAL_EMBEDDING_MODEL.urls],
            targetPath: embeddingStatus?.modelPath ?? null,
        },
    ], [
        activeTranscriptionStatus,
        dictionaryStatus?.installed,
        embeddingStatus,
        selectedItems,
        t,
        ttsStatus,
        usesWhisperCpp,
    ]);

    const bundleEntries = React.useMemo(
        () => allBundleEntries.filter((entry) => entry.checked),
        [allBundleEntries],
    );
    const pendingEntries = React.useMemo(
        () => bundleEntries.filter((entry) => !entry.ready),
        [bundleEntries],
    );
    const pendingSizeLabel = React.useMemo(() => {
        const bytes = pendingEntries.reduce((sum, entry) => sum + entry.bytes, 0);
        return formatGigabytesOrMegabytes(bytes);
    }, [pendingEntries]);
    const allReady = pendingEntries.length === 0;

    /** 整体字节加权进度；若在下载前没有字节总量，按项数均分保底。 */
    const overallPercent = (() => {
        if (packProgress.totalBytes > 0) {
            const currentBytes = Math.min(live.total || live.downloaded, live.downloaded);
            return Math.min(100, Math.floor(((packProgress.completedBytes + currentBytes) / packProgress.totalBytes) * 100));
        }
        return packProgress.count > 0
            ? Math.min(100, Math.floor(((packProgress.completed + live.percent / 100) / packProgress.count) * 100))
            : 0;
    })();

    const remainingLabel = (() => {
        if (live.speed <= 0 || live.total <= live.downloaded) return null;
        const seconds = (live.total - live.downloaded) / live.speed;
        if (seconds >= 3600) return t('steps.download.etaLong');
        return seconds >= 60
            ? t('steps.download.etaMinutes', {
                minutes: Math.floor(seconds / 60),
                seconds: Math.round(seconds % 60),
            })
            : t('steps.download.etaSeconds', { seconds: Math.max(1, Math.round(seconds)) });
    })();

    const activeEntryTitle = bundleEntries.find((entry) => entry.key === activeItem)?.title ?? '';
    const progressPhaseLabel = activePhase && PHASE_LABEL_KEYS[activePhase]
        ? t(PHASE_LABEL_KEYS[activePhase] as string)
        : t('steps.download.downloadingEnv');
    const progressLabel = activeEntryTitle
        ? t('steps.download.activeItemProgress', { item: activeEntryTitle, phase: progressPhaseLabel })
        : progressPhaseLabel;

    /**
     * 保存引导结果并进入完成页：
     * - ASR：仅在推荐引擎模型已就绪时切到目标引擎，未就绪时不存指向缺失模型的引擎。
     * - AI 路由：本地大模型已就绪 -> 字幕翻译/词典/整句学习全路由 local；否则仅在已配云端时保留 openai，避免空凭据报错。
     */
    const finishOnboarding = async () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        dispatch('START_FINISH');
        try {
            const [current, credentials, whisperCpp, parakeet, localAi] = await Promise.all([
                settingsApi.getEngineSelection(),
                settingsApi.getServiceCredentials?.().catch(() => null) ?? Promise.resolve(null),
                settingsApi.getWhisperCppModelStatus?.().catch(() => null) ?? Promise.resolve(null),
                settingsApi.getParakeetModelStatus?.().catch(() => null) ?? Promise.resolve(null),
                settingsApi.getLocalAiStatus?.().catch(() => null) ?? Promise.resolve(null),
            ]);

            if (usesWhisperCpp && whisperCpp?.ready) {
                await settingsApi.saveTranscriptionEngine('whisper-cpp');
            } else if (!usesWhisperCpp && parakeet?.ready) {
                await settingsApi.saveTranscriptionEngine('sherpa-onnx');
            }

            const readyLocalModels = localAi?.models.filter((item) => item.ready) ?? [];
            const preferredReadyLocal = readyLocalModels.find((item) => item.modelId === advice.recommendedLocalModelId)
                ?? readyLocalModels[0];
            if (preferredReadyLocal) {
                await settingsApi.useLocalAiModel?.(preferredReadyLocal.modelId).catch(() => undefined);
            }

            const hasCloudCreds = Boolean(
                credentials?.openai.endpoint
                && credentials.openai.models.length > 0
                && (credentials.openai.hasKey || isLocalLlmEndpoint(credentials.openai.endpoint)),
            );
            const fallbackCloudModel = credentials?.openai.models[0] ?? '';
            const useCloudForAi = Boolean(cloudSavedProvider && hasCloudCreds);

            if (useCloudForAi) {
                await settingsApi.saveEngineSelection({
                    ...current,
                    openai: {
                        ...current.openai,
                        enableSentenceLearning: true,
                        featureModels: {
                            sentenceLearning: fallbackCloudModel,
                            subtitleTranslation: fallbackCloudModel,
                            dictionary: fallbackCloudModel,
                        },
                    },
                    providers: {
                        ...current.providers,
                        subtitleTranslationEngine: 'openai',
                        dictionaryEngine: 'openai',
                        embeddingEngine: 'auto',
                    },
                });
            } else if (preferredReadyLocal) {
                await settingsApi.saveEngineSelection({
                    ...current,
                    openai: {
                        ...current.openai,
                        enableSentenceLearning: true,
                        featureModels: {
                            ...current.openai.featureModels,
                            sentenceLearning: 'local',
                            subtitleTranslation: '',
                            dictionary: '',
                        },
                    },
                    providers: {
                        ...current.providers,
                        subtitleTranslationEngine: 'local',
                        dictionaryEngine: 'local',
                        embeddingEngine: 'auto',
                    },
                });
            } else {
                const cloudSubtitleReady = hasCloudCreds
                    && current.providers.subtitleTranslationEngine === 'openai'
                    && Boolean(current.openai.featureModels.subtitleTranslation);
                await settingsApi.saveEngineSelection({
                    ...current,
                    openai: {
                        ...current.openai,
                        enableSentenceLearning: hasCloudCreds ? current.openai.enableSentenceLearning : false,
                        featureModels: {
                            sentenceLearning: hasCloudCreds ? current.openai.featureModels.sentenceLearning : '',
                            subtitleTranslation: cloudSubtitleReady ? current.openai.featureModels.subtitleTranslation : '',
                            dictionary: hasCloudCreds ? current.openai.featureModels.dictionary : '',
                        },
                    },
                    providers: {
                        ...current.providers,
                        subtitleTranslationEngine: cloudSubtitleReady ? 'openai' : 'none',
                        dictionaryEngine: 'none',
                        embeddingEngine: 'auto',
                    },
                });
            }

            await markOnboardingCompleted(CURRENT_ONBOARDING_VERSION);
            dispatch('FINISH_OK');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
            dispatch('FINISH_FAILED');
        } finally {
            finishingRef.current = false;
        }
    };

    const runBundleEntry = async (key: BundleItemKey): Promise<void> => {
        const assertOk = (res: { success?: boolean; message?: string } | void) => {
            if (res && res.success === false) {
                throw new Error(res.message || 'Download failed');
            }
        };
        switch (key) {
            case 'dictionaryEnhancement':
                await runDictionaryEnhancementInstall();
                return;
            case 'tts':
                assertOk(await settingsApi.downloadSherpaTtsModel());
                return;
            case 'transcription':
                if (usesWhisperCpp) {
                    assertOk(await settingsApi.downloadWhisperCppModel());
                } else {
                    assertOk(await settingsApi.downloadParakeetModel());
                }
                return;
            case 'embedding':
                await settingsApi.downloadEmbeddingModel();
                return;
        }
    };

    const cancelBundleEntry = async (key: BundleItemKey): Promise<void> => {
        switch (key) {
            case 'dictionaryEnhancement':
                if (activeDictTaskIdRef.current !== null) {
                    await englishDictionaryApi.cancel?.(activeDictTaskIdRef.current);
                }
                return;
            case 'tts':
                await settingsApi.cancelSherpaTtsModelDownload();
                return;
            case 'transcription':
                if (usesWhisperCpp) {
                    await settingsApi.cancelWhisperCppModelDownload();
                } else {
                    await settingsApi.cancelParakeetModelDownload();
                }
                return;
            case 'embedding':
                await settingsApi.cancelEmbeddingModelDownload();
                return;
        }
    };

    const downloadBundle = async () => {
        if (downloadingBundleRef.current || finishingRef.current) return;
        const queue = pendingEntries;
        if (queue.length === 0) {
            await finishOnboarding();
            return;
        }
        downloadingBundleRef.current = true;
        cancelRequestedRef.current = false;
        setBundleError(null);
        setDownloadingBundle(true);
        const totalBytes = queue.reduce((sum, item) => sum + item.bytes, 0);
        setPackProgress({ completed: 0, count: queue.length, completedBytes: 0, totalBytes });
        try {
            let doneBytes = 0;
            for (const entry of queue) {
                activeItemRef.current = entry.key;
                setActiveItem(entry.key);
                setActivePhase(null);
                liveRef.current = { percent: 0, downloaded: 0, total: entry.bytes, speed: 0 };
                setLive({ percent: 0, downloaded: 0, total: entry.bytes, speed: 0 });
                speedSampleRef.current = null;
                await runBundleEntry(entry.key);
                if (cancelRequestedRef.current) break;
                doneBytes += entry.bytes;
                setPackProgress((previous) => ({
                    ...previous,
                    completed: previous.completed + 1,
                    completedBytes: doneBytes,
                }));
            }
            if (!cancelRequestedRef.current) {
                await finishOnboarding();
            }
        } catch (error) {
            if (!cancelRequestedRef.current) {
                setBundleError(error instanceof Error ? error.message : String(error));
            }
        } finally {
            activeItemRef.current = null;
            downloadingBundleRef.current = false;
            setActiveItem(null);
            setActivePhase(null);
            setDownloadingBundle(false);
        }
    };

    const openManualGuide = async () => {
        if (downloadingBundleRef.current) {
            await cancelBundleDownload();
        }
        dispatch('OPEN_MANUAL');
    };

    const cancelBundleDownload = async () => {
        cancelRequestedRef.current = true;
        const currentKey = activeItemRef.current ?? activeItem;
        if (!currentKey) return;
        try {
            await cancelBundleEntry(currentKey);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    return {
        screen,
        dispatch,
        finishing,
        hardware,
        advice,
        storagePath,
        storageAvailable,
        choosingStorage,
        handleChooseStorage,
        selectedTier,
        selectTier,
        toggleItem,
        allBundleEntries,
        bundleEntries,
        downloadingBundle,
        overallPercent,
        progressLabel,
        live,
        allReady,
        pendingSizeLabel,
        bundleError,
        remainingLabel,
        cloudQuickOpen,
        setCloudQuickOpen,
        cloudPresetId,
        selectCloudPreset,
        cloudApiKey,
        setCloudApiKey,
        cloudModelId,
        setCloudModelId,
        cloudSaving,
        cloudSavedProvider,
        saveQuickCloudSetup,
        downloadBundle,
        cancelBundleDownload,
        openManualGuide,
        finishOnboarding,
        copyText,
        openUrl,
        openFolder,
    };
}
