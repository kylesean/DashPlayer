import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type { LearningSessionSummaryParams } from '@/common/types/learningSession';

/**
 * 学习数据与播放会话摘要接口。
 */
export const learningDataApi = {
    /**
     * 查询某个播放会话的学习摘要。
     */
    getSessionSummary: (params: LearningSessionSummaryParams) =>
        backendClient.call('learning-data/session-summary', params),

    /**
     * 打开保存对话框并导出学习数据 JSON。
     */
    exportLearningData: () => backendClient.call('learning-data/export'),

    /**
     * 清除学习事件、复习卡与掌握字段；词表与用户状态保留。
     */
    resetLearningData: () => backendClient.call('learning-data/reset'),
};
