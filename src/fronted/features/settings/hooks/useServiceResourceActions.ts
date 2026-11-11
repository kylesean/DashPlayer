import React from 'react';
import { toast } from 'react-hot-toast';
import type { KeyedMutator } from 'swr';
import type { TFunction } from 'i18next';
import { settingsApi } from '@/fronted/features/settings/settingsApi';
import type { LocalAiModelStatus } from '@/common/contracts/local-ai';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';

type ResourceStatus = Awaited<ReturnType<typeof settingsApi.getResourceStatus>>;

export interface ServiceResourceActionsOptions {
    /** 设置页命名空间的翻译函数。 */
    t: TFunction;
    /** 资源状态 SWR 的 mutate。 */
    refreshResourceStatus: KeyedMutator<ResourceStatus>;
    /** 云端密钥表单的即时落盘；测试连通性前必须先保存。 */
    flushCredentials: () => Promise<void>;
    /** 当前本地增强模型状态，用于补全下载失败时的模型名。 */
    localAiStatus: ResourceStatus['localAi'] | null;
    /** 当前哪些缓存会被"清空缓存"命中。 */
    cacheTargets: { subtitle: boolean; dictionary: boolean };
}

/**
 * 服务与资源页的动作层：译/识引擎切换、缓存清理、本地模型下载与测速、云端测试。
 *
 * 这些动作只依赖 settingsApi、toast 与 SWR 的刷新函数，属于页面副作用而不是 UI 状态；
 * 抽到 hook 后组件只保留表单与分区展示，不再内联 try/catch/toast 流程。
 */
export function useServiceResourceActions({
    t,
    refreshResourceStatus,
    flushCredentials,
    localAiStatus,
    cacheTargets,
}: ServiceResourceActionsOptions) {
    // 云端密钥的连通性测试
    const [testingOpenAiModel, setTestingOpenAiModel] = React.useState<string | null>(null);
    const [openAiTestResults, setOpenAiTestResults] = React.useState<Record<string, {
        success: boolean;
        message: string;
    } | null>>({});

    // 本地增强模型
    const [localAiBusy, setLocalAiBusy] = React.useState(false);
    const [clearingCache, setClearingCache] = React.useState(false);
    /** 清缓存确认弹窗是否打开。 */
    const [cacheConfirmOpen, setCacheConfirmOpen] = React.useState(false);
    const [testingModelId, setTestingModelId] = React.useState<string | null>(null);
    const [testResultsMap, setTestResultsMap] = React.useState<Record<string, {
        success: boolean;
        warmSec: string;
        tps: string;
        errorMessage?: string;
    } | null>>({});

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
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
            return false;
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
            return true;
        } catch (error) {
            toast.error(`${localAiDisplayName(model)}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
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

    /** 取消本地模型下载：与下载共用忙碌态，结束后刷新资源状态。 */
    const cancelLocalAiDownload = () => {
        setLocalAiBusy(true);
        void settingsApi.cancelLocalAiDownload()
            .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
            .finally(() => {
                setLocalAiBusy(false);
                void refreshResourceStatus();
            });
    };

    /** 模型被删除后清掉它的连通性测试结果，避免残留过期信息。 */
    const forgetOpenAiTestResult = (model: string) => {
        setOpenAiTestResults((prev) => {
            const next = { ...prev };
            delete next[model];
            return next;
        });
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

    return {
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
    };
}
