import type { EnglishDictionaryStatusVO } from '@/common/contracts/english-dictionary';
import { backendClient } from '@/frontend/infrastructure/electron/backendClient';

/**
 * 英英释义增强包的前端 API 封装。
 */
export const englishDictionaryApi = {
    /** 读取安装/下载状态。 */
    status: (): Promise<EnglishDictionaryStatusVO> => backendClient.call('dictionary-enhancement/status'),

    /** 启动安装（下载 + 构建）；返回后台任务 ID。 */
    install: (): Promise<number> => backendClient.call('dictionary-enhancement/install'),

    /** 取消安装任务。 */
    cancel: (taskId: number): Promise<void> => backendClient.call('dictionary-enhancement/cancel', { taskId }),

    /** 删除已安装的增强包。 */
    remove: (): Promise<void> => backendClient.call('dictionary-enhancement/remove'),
};
