import React from 'react';
import { useTranslation as useI18nTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import { markOnboardingCompleted } from '@/fronted/features/onboarding/onboardingApi';
import { subscribeArchiveDownloadProgress } from '@/fronted/features/settings/settingsEvents';
import { CURRENT_ONBOARDING_VERSION } from '@/common/constants/onboarding';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';
import type { ModelDownloadPhase } from '@/common/contracts/model-download-phase';
import {
    isFinishing,
    transitionOnboardingScreen,
    type OnboardingEvent,
    type OnboardingScreen,
} from '@/fronted/features/onboarding/lib/onboarding-screen';

/** 离线资源包内资源项的标识；数组顺序即下载顺序（先小后大）。 */
type BundleItemKey = 'tts' | 'transcription';

/** 网速的指数滑动平均系数，抑制进度事件抖动。 */
const SPEED_SMOOTHING = 0.3;

/**
 * 进度与网速刷新到 UI 的最小间隔（毫秒）。
 *
 * 主进程的进度事件每 100~200 毫秒就来一次，直接写进 state 会让百分比与网速
 * 疯狂跳动；这里先累积到 ref，按固定节奏刷新，数字看起来稳定得多。
 */
const PROGRESS_RENDER_INTERVAL_MS = 500;

/** 下载完成后的收尾阶段文案；未收录的阶段回落到通用下载提示。 */
const PHASE_LABEL_KEYS: Partial<Record<ModelDownloadPhase, string>> = {
    verifying: 'steps.download.verifying',
    extracting: 'steps.download.extracting',
    installing: 'steps.download.installing',
};

/** 资源包内单项资源的展示信息与下载动作。 */
export interface BundleEntry {
    key: BundleItemKey;
    /** 手动下载教程里展示的名字。 */
    title: string;
    ready: boolean;
    /** 有序候选下载地址（首个为主源，其余为备用镜像）。 */
    urls: readonly string[] | null;
    /** 手动下载后应保存到的路径。 */
    targetPath: string | null;
    /** 执行该项下载；失败时抛出。 */
    run: () => Promise<void>;
    /** 取消该项下载。 */
    cancel: () => Promise<void>;
}

/**
 * 并发拉取存储位置、语音合成模型与字幕识别引擎的当前就绪状态。
 */
async function fetchOnboardingStatuses() {
    const [storageStatus, tts, transcription] = await Promise.all([
        settingsApi.getStorageStatus().catch(() => null),
        settingsApi.getSherpaTtsModelStatus().catch(() => null),
        settingsApi.getWhisperCppModelStatus().catch(() => null),
    ]);
    return { storageStatus, tts, transcription };
}

/**
 * 引导页的资源编排：状态检测、下载队列、进度订阅、取消与收尾。
 *
 * 页面组件只消费返回的状态与动作，不再内联串行队列和 IPC 副作用；
 * 屏幕切换仍由 onboarding-screen.ts 的转移表裁决。
 */
export function useOnboardingBundle() {
    const { t } = useI18nTranslation('onboarding');

    const [screen, setScreen] = React.useState<OnboardingScreen>('storage');
    const finishing = isFinishing(screen);

    /**
     * 派发一个引导事件。
     *
     * 非法转移直接忽略，避免「收尾途中被导航打断」这类竞态。
     *
     * @param event 触发事件。
     */
    const dispatch = React.useCallback((event: OnboardingEvent): void => {
        setScreen((current) => transitionOnboardingScreen(current, event) ?? current);
    }, []);

    // 存储位置（页面左下角的小元素，默认值可直接用）
    const [storagePath, setStoragePath] = React.useState('');
    const [storageAvailable, setStorageAvailable] = React.useState(true);
    const [choosingStorage, setChoosingStorage] = React.useState(false);

    // 资源包内资源项的状态（识别一项固定检测 whisper.cpp 核显引擎，GPU 优先）
    const [ttsStatus, setTtsStatus] = React.useState<ModelInstallationStatusVO | null>(null);
    const [transcriptionStatus, setTranscriptionStatus] = React.useState<ModelInstallationStatusVO | null>(null);

    // 下载过程
    const [downloadingBundle, setDownloadingBundle] = React.useState(false);
    const [activeItem, setActiveItem] = React.useState<BundleItemKey | null>(null);
    const [activePhase, setActivePhase] = React.useState<ModelDownloadPhase | null>(null);
    /** 整体进度按项数均分：已完成项数 + 当前项的完成比例。 */
    const [packProgress, setPackProgress] = React.useState({ completed: 0, count: 0 });
    /** 展示用的进度与网速；由 liveRef 按固定间隔刷新，避免数字频繁跳动。 */
    const [live, setLive] = React.useState({ percent: 0, downloaded: 0, total: 0, speed: 0 });
    /** 进度事件写入的原始快照。 */
    const liveRef = React.useRef({ percent: 0, downloaded: 0, total: 0, speed: 0 });
    const [bundleError, setBundleError] = React.useState<string | null>(null);
    /** 用户是否点了取消：用于中断串行队列，并区分"取消"与"失败"。 */
    const cancelRequestedRef = React.useRef(false);
    /** 最近一次进度采样，用于估算网速。 */
    const speedSampleRef = React.useRef<{ at: number; downloaded: number } | null>(null);

    /** 将拉取到的资源状态写入 hook 状态。 */
    const applyStatuses = React.useCallback((result: Awaited<ReturnType<typeof fetchOnboardingStatuses>>) => {
        if (result.storageStatus) {
            setStoragePath(result.storageStatus.resolvedPath);
            setStorageAvailable(result.storageStatus.available);
        }
        if (result.tts) setTtsStatus(result.tts);
        if (result.transcription) setTranscriptionStatus(result.transcription);
    }, []);

    /** 拉取存储位置与资源包内资源项的状态。 */
    const refreshAllStatuses = React.useCallback(async () => {
        try {
            const result = await fetchOnboardingStatuses();
            applyStatuses(result);
        } catch {
            // 状态拉取失败不阻断引导：页面保持"未下载"，用户仍可点下载或跳过
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
        // 用户可能在文件管理器里删掉或移动模型目录，窗口重新获得焦点时重新检测
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

    /** 记录一次进度采样：写入原始快照，并用指数滑动平均估算网速。 */
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

    // 按固定节奏把原始进度刷到界面上
    React.useEffect(() => {
        if (!downloadingBundle) return undefined;
        const timer = window.setInterval(() => {
            setLive({ ...liveRef.current });
        }, PROGRESS_RENDER_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [downloadingBundle]);

    // 订阅主进程推送的下载进度
    React.useEffect(() => {
        const unsubscribe = subscribeArchiveDownloadProgress((detail) => {
            setActivePhase(detail.phase);
            if (detail.phase === 'downloading' && detail.total > 0) {
                trackProgress(detail.downloaded, detail.total);
            }
            if (detail.phase === 'idle') void refreshAllStatuses();
        });
        return unsubscribe;
    }, [refreshAllStatuses, trackProgress]);

    /** 复制文本到剪贴板。 */
    const copyText = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(t('copied'));
        } catch {
            toast.error(t('copyFailed'));
        }
    };

    /** 在系统浏览器中打开下载地址。 */
    const openUrl = async (url: string) => {
        try {
            await settingsApi.openUrl(url);
        } catch {
            toast.error(t('openUrlFailed'));
        }
    };

    /** 打开模型文件所在文件夹。 */
    const openFolder = async (path: string) => {
        try {
            await settingsApi.openFolderForFile(path);
        } catch {
            toast.error(t('openFolderFailed'));
        }
    };

    /** 选择媒体库与模型存放目录，并立即生效。 */
    const handleChooseStorage = async () => {
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
            setChoosingStorage(false);
        }
    };

    /** 资源包内的资源项；顺序即下载顺序。 */
    const bundleEntries: BundleEntry[] = [
        {
            key: 'tts',
            title: t('steps.models.ttsTitle'),
            ready: ttsStatus?.ready ?? false,
            urls: ttsStatus?.downloadUrls ?? null,
            targetPath: ttsStatus?.archivePath ?? null,
            run: async () => { await settingsApi.downloadSherpaTtsModel(); },
            cancel: async () => { await settingsApi.cancelSherpaTtsModelDownload(); },
        },
        {
            // 字幕识别固定走 whisper.cpp 核显引擎（GPU 优先）；老用户的 sherpa-onnx
            // 只是升级初期的过渡，完成后设置页仍可手动切回。
            key: 'transcription',
            title: t('steps.models.transcriptionTitle'),
            ready: transcriptionStatus?.ready ?? false,
            urls: transcriptionStatus?.downloadUrls ?? null,
            targetPath: transcriptionStatus?.archivePath ?? null,
            run: async () => { await settingsApi.downloadWhisperCppModel(); },
            cancel: async () => { await settingsApi.cancelWhisperCppModelDownload(); },
        },
    ];
    const pendingEntries = bundleEntries.filter((entry) => !entry.ready);
    const allReady = pendingEntries.length === 0;
    /** 整体进度百分比：已完成项按整项计入，当前项按其自身进度折算。 */
    const overallPercent = packProgress.count > 0
        ? Math.min(100, Math.floor(((packProgress.completed + live.percent / 100) / packProgress.count) * 100))
        : 0;
    /** 当前这一项的剩余时间文案；网速未知时为 null。 */
    const remainingLabel = (() => {
        if (live.speed <= 0 || live.total <= live.downloaded) return null;
        const seconds = (live.total - live.downloaded) / live.speed;
        // 低速下按秒数推算会得到毫无意义的大数，超过一小时只给个模糊说法
        if (seconds >= 3600) return t('steps.download.etaLong');
        return seconds >= 60
            ? t('steps.download.etaMinutes', {
                minutes: Math.floor(seconds / 60),
                seconds: Math.round(seconds % 60),
            })
            : t('steps.download.etaSeconds', { seconds: Math.max(1, Math.round(seconds)) });
    })();
    /** 下载中展示的阶段文案：优先收尾阶段，其次统一的"正在下载运行环境"。 */
    const progressLabel = activePhase && PHASE_LABEL_KEYS[activePhase]
        ? t(PHASE_LABEL_KEYS[activePhase] as string)
        : t('steps.download.downloadingEnv');

    /**
     * 保存引导结果并进入完成页。
     *
     * 识别引擎 GPU 优先：whisper.cpp 模型就绪时切到核显引擎；未就绪时保留当前
     * 引擎（走过老版本迁移的用户为 sherpa-onnx CPU），避免存下指向缺失模型的引擎。
     * 字幕翻译保持用户在引导中的选择（本地大模型需先在本地模型页下载，指向
     * 未下载的模型会在使用时显式报错），引导不代做引擎决定。
     * 词典固定走内置词库（引擎关闭），超出词库的查询留到设置页再配。
     */
    const finishOnboarding = async () => {
        dispatch('START_FINISH');
        try {
            const [current, whisperCpp] = await Promise.all([
                settingsApi.getEngineSelection(),
                settingsApi.getWhisperCppModelStatus(),
            ]);
            await settingsApi.saveEngineSelection({
                ...current,
                providers: {
                    ...current.providers,
                    dictionaryEngine: 'none',
                },
            });
            if (whisperCpp.ready) {
                await settingsApi.saveTranscriptionEngine('whisper-cpp');
            }
            await markOnboardingCompleted(CURRENT_ONBOARDING_VERSION);
            dispatch('FINISH_OK');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
            // 失败退回下载页：用户能重试，也能改走手动下载。
            dispatch('FINISH_FAILED');
        }
    };

    /**
     * 依次下载资源包里尚未完成的项，全部成功后保存配置并进入完成页。
     *
     * 串行而非并发：同时下载会互相抢带宽，进度也难以理解。
     * 任一项失败即停下（原因展示在主按钮下方），已完成的部分保留。
     */
    const downloadBundle = async () => {
        cancelRequestedRef.current = false;
        setBundleError(null);
        setDownloadingBundle(true);
        setPackProgress({ completed: 0, count: pendingEntries.length });
        try {
            for (const entry of pendingEntries) {
                setActiveItem(entry.key);
                setActivePhase(null);
                liveRef.current = { percent: 0, downloaded: 0, total: 0, speed: 0 };
                setLive({ percent: 0, downloaded: 0, total: 0, speed: 0 });
                speedSampleRef.current = null;
                await entry.run();
                if (cancelRequestedRef.current) break;
                setPackProgress((previous) => ({ ...previous, completed: previous.completed + 1 }));
            }
            if (!cancelRequestedRef.current) {
                await finishOnboarding();
            }
        } catch (error) {
            if (!cancelRequestedRef.current) {
                setBundleError(error instanceof Error ? error.message : String(error));
            }
        } finally {
            setActiveItem(null);
            setActivePhase(null);
            setDownloadingBundle(false);
        }
    };

    /**
     * 打开手动下载页。
     *
     * 下载中先中断当前下载：手动下载与自动下载同时进行会互相抢带宽，
     * 而且用户之所以要看手动教程，多半就是自动下载走不通。
     */
    const openManualGuide = async () => {
        if (downloadingBundle) {
            await cancelBundleDownload();
        }
        dispatch('OPEN_MANUAL');
    };

    /** 取消当前项的下载并中断队列。 */
    const cancelBundleDownload = async () => {
        cancelRequestedRef.current = true;
        const entry = bundleEntries.find((item) => item.key === activeItem);
        if (!entry) return;
        try {
            await entry.cancel();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
        }
    };

    return {
        screen,
        dispatch,
        finishing,
        storagePath,
        storageAvailable,
        choosingStorage,
        handleChooseStorage,
        bundleEntries,
        downloadingBundle,
        overallPercent,
        progressLabel,
        live,
        allReady,
        bundleError,
        remainingLabel,
        downloadBundle,
        cancelBundleDownload,
        openManualGuide,
        finishOnboarding,
        copyText,
        openUrl,
        openFolder,
    };
}
