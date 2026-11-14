import { backendClient } from '@/frontend/infrastructure/electron/backendClient';
import type {
    YoutubeImportSettingDetailVO,
    YoutubeImportSettingSaveVO,
    YoutubeImportStartResult,
} from '@/common/contracts/youtube-import';

/**
 * YouTube 导入功能调用的后端接口。
 */
export const youtubeImportApi = {
    /**
     * 发起一次 YouTube 链接导入。
     *
     * @param url 用户粘贴的视频地址。
     * @returns 后台任务编号。
     */
    start: (url: string): Promise<YoutubeImportStartResult> => backendClient.call('youtube-import/start', { url }),

    /**
     * 取消进行中的导入任务。
     *
     * @param taskId 后台任务编号。
     * @returns 是否发出了取消请求。
     */
    cancel: (taskId: number): Promise<{ cancelled: boolean }> => backendClient.call('youtube-import/cancel', { taskId }),

    /**
     * 查询功能开关状态。
     *
     * @returns 设置详情。
     */
    getSettingDetail: (): Promise<YoutubeImportSettingDetailVO> => backendClient.call('youtube-import/setting-detail'),

    /**
     * 保存功能开关。
     *
     * @param vo 保存值。
     * @returns 保存后的设置详情。
     */
    saveSetting: (vo: YoutubeImportSettingSaveVO): Promise<YoutubeImportSettingDetailVO> =>
        backendClient.call('youtube-import/setting-save', vo),
};
