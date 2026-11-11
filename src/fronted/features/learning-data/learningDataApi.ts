import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type { LearningSessionSummaryParams } from '@/common/types/learningSession';
import type {
    LearningRecapParams,
    RetellEvaluationParams,
} from '@/common/types/learningRecap';

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
     * 生成当前播放会话的学习复盘。
     */
    getRecap: (params: LearningRecapParams) =>
        backendClient.call('learning-data/recap', params),

    /**
     * 检查用户对原句的复述。
     */
    evaluateRetell: (params: RetellEvaluationParams) =>
        backendClient.call('learning-data/retell-feedback', params),

    /**
     * 打开保存对话框并导出学习数据 JSON。
     */
    exportLearningData: () => backendClient.call('learning-data/export'),

    /**
     * 清除学习事件、复习卡与掌握字段；词表与用户状态保留。
     */
    resetLearningData: () => backendClient.call('learning-data/reset'),
};
