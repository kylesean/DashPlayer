import type { RegisterRendererApi } from '@/fronted/infrastructure/electron/rendererApiRegistry';
import type { RendererApiDefinitions } from '@/common/api/renderer-api-def';

/**
 * 离线模型归档下载解压进度事件负载。
 */
export type ArchiveDownloadProgressEvent = RendererApiDefinitions['settings/sherpa-tts-model-download-progress']['params'];

/**
 * LocalAI 模型下载进度事件负载。
 */
export type LocalAiDownloadProgressEvent = RendererApiDefinitions['settings/local-ai-model-download-progress']['params'];

type ArchiveProgressListener = (progress: ArchiveDownloadProgressEvent) => void;
type LocalAiProgressListener = (progress: LocalAiDownloadProgressEvent) => void;

const archiveListeners = new Set<ArchiveProgressListener>();
const localAiListeners = new Set<LocalAiProgressListener>();

/**
 * 订阅离线模型解压与下载进度事件（sherpa-tts / whisper-cpp / parakeet）。
 *
 * @param listener 进度回调函数。
 * @returns 取消订阅函数。
 */
export function subscribeArchiveDownloadProgress(listener: ArchiveProgressListener): () => void {
    archiveListeners.add(listener);
    return () => {
        archiveListeners.delete(listener);
    };
}

/**
 * 订阅 LocalAI 模型下载进度事件。
 *
 * @param listener 进度回调函数。
 * @returns 取消订阅函数。
 */
export function subscribeLocalAiDownloadProgress(listener: LocalAiProgressListener): () => void {
    localAiListeners.add(listener);
    return () => {
        localAiListeners.delete(listener);
    };
}

/**
 * 注册设置与离线模型资源下载相关的 main 进程回调通道。
 *
 * @param register 接口注册函数。
 */
export function registerSettingsRendererApis(register: RegisterRendererApi): void {
    const notifyArchive = (detail: ArchiveDownloadProgressEvent) => {
        archiveListeners.forEach((listener) => {
            try {
                listener(detail);
            } catch {
                // 忽略单个监听器的异常，避免阻断其余监听器
            }
        });
    };

    register('settings/parakeet-model-download-progress', async (params) => {
        notifyArchive(params);
    });

    register('settings/sherpa-tts-model-download-progress', async (params) => {
        notifyArchive(params);
    });

    register('settings/whisper-cpp-model-download-progress', async (params) => {
        notifyArchive(params);
    });

    register('settings/local-ai-model-download-progress', async (params) => {
        localAiListeners.forEach((listener) => {
            try {
                listener(params);
            } catch {
                // 忽略单个监听器的异常
            }
        });
    });
}
