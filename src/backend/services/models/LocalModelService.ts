import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';

/**
 * 本地模型管理的统一契约。
 *
 * whisper.cpp、Parakeet 与 Sherpa TTS 都是「一个安装目录 + 一份必需文件清单」，
 * 对外只需要状态、下载、取消与删除四个动作，因此共用这一份形状。
 */
export default interface LocalModelService {
    /**
     * 查询模型是否已完整安装。
     * @returns 模型路径、就绪状态与缺失文件。
     */
    getStatus(): Promise<ModelInstallationStatusVO>;

    /**
     * 下载模型并完成原子安装。
     * @returns 下载操作结果。
     */
    download(): Promise<{ success: boolean; message: string }>;

    /**
     * 取消进行中的模型下载；无下载任务时直接返回。
     * @returns 是否确实中止了一个下载任务。
     */
    cancelDownload(): Promise<{ cancelled: boolean }>;

    /**
     * 删除已安装的模型目录。
     * @returns 删除结果；模型不存在时视为已删除。
     */
    deleteModel(): Promise<{ success: boolean; message: string }>;
}
