import { backendClient } from '@/frontend/infrastructure/electron/backendClient';
import type {
    ContentCompassEventParams,
    ContentCompassListParams,
    ContentCompassStatsParams,
} from '@/common/types/contentCompass';

/**
 * 内容指南针 IPC 接口。
 */
export const contentCompassApi = {
    list: (params: ContentCompassListParams = {}) =>
        backendClient.call('content-compass/list', params),

    recordEvent: (params: ContentCompassEventParams) =>
        backendClient.call('content-compass/event', params),

    getStats: (params: ContentCompassStatsParams = {}) =>
        backendClient.call('content-compass/stats', params),

    /**
     * 推荐的四段因果漏斗：曝光 → 打开 → 复习 → 回忆成功。
     */
    getAttribution: (params: { days?: number } = {}) =>
        backendClient.call('content-compass/attribution', params),
};
