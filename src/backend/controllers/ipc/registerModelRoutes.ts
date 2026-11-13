import registerRoute from '@/backend/controllers/ipc/registerRoute';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';

/**
 * 本地模型管理服务的最小契约：状态、下载、取消下载与删除。
 *
 * whisper.cpp、Parakeet 与 Sherpa TTS 三个引擎的 IPC 形状完全一致，
 * 差异只有路由前缀和注入的具体服务实现。
 */
export interface LocalModelManagementService {
    /** 查询模型是否已完整安装。 */
    getStatus(): Promise<ModelInstallationStatusVO>;
    /** 下载并原子安装模型。 */
    download(): Promise<{ success: boolean; message: string }>;
    /** 取消进行中的下载。 */
    cancelDownload(): Promise<{ cancelled: boolean }>;
    /** 删除已安装的模型目录。 */
    deleteModel(): Promise<{ success: boolean; message: string }>;
}

/** 采用统一模型管理路由的引擎前缀。 */
export type LocalModelRoutePrefix = 'whisper-cpp' | 'parakeet' | 'sherpa-tts' | 'phoneme-gop' | 'sense-voice';

/**
 * 注册一个本地模型的四条管理路由。
 *
 * 路径由前缀机械派生，避免三个控制器各自手写时出现
 * `cancel-download` / `cancelDownload` 一类的拼写漂移；新增同构模型时
 * 在 {@link LocalModelRoutePrefix} 里补一个前缀即可。
 *
 * @param prefix 引擎路由前缀，例如 `whisper-cpp`。
 * @param service 该引擎的模型管理服务。
 */
export default function registerModelRoutes(
    prefix: LocalModelRoutePrefix,
    service: LocalModelManagementService,
): void {
    registerRoute(`${prefix}/models/status`, () => service.getStatus());
    registerRoute(`${prefix}/models/download`, () => service.download());
    registerRoute(`${prefix}/models/cancel-download`, () => service.cancelDownload());
    registerRoute(`${prefix}/models/delete`, () => service.deleteModel());
}
