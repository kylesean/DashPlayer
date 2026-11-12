import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type { LearningSessionSummaryParams } from '@/common/types/learningSession';
import type {
    LearningRecapParams,
    ProductionPracticeListParams,
    RetellEvaluationParams,
    RolePlayFeedbackParams,
    RolePlaySessionParams,
    RolePlayTurnParams,
} from '@/common/types/learningRecap';
import type { MemoryMapParams } from '@/common/types/memoryMap';
import type { LearningMetricsParams, LearningMetricsVO } from '@/common/types/learningMetrics';

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
     * 检查用户对场景开场白的书面回应。
     */
    evaluateRolePlay: (params: RolePlayFeedbackParams) =>
        backendClient.call('learning-data/role-play-feedback', params),

    /**
     * 提交多轮场景对话中的一轮，并拿到该轮点评。
     */
    evaluateRolePlayTurn: (params: RolePlayTurnParams) =>
        backendClient.call('learning-data/role-play-turn', params),

    /**
     * 读取某个多轮场景对话已经发生的轮次，用于重开弹窗续聊。
     */
    getRolePlaySession: (params: RolePlaySessionParams) =>
        backendClient.call('learning-data/role-play-session', params),

    /**
     * 读取某个视频下最近的复述 / 角色扮演结果，用于展示「上次结果」。
     */
    listProductionPractice: (params: ProductionPracticeListParams) =>
        backendClient.call('learning-data/production-practice', params),

    /**
     * 生成个人记忆图谱。
     */
    getMemoryMap: (params: MemoryMapParams = {}) =>
        backendClient.call('learning-data/memory-map', params),

    /**
     * 学习指标看板：北极星指标与辅助指标。
     */
    getMetrics: (params: LearningMetricsParams = {}): Promise<LearningMetricsVO> =>
        backendClient.call('learning-data/metrics', params),

    /**
     * 打开保存对话框并导出学习数据 JSON。
     */
    exportLearningData: () => backendClient.call('learning-data/export'),

    /**
     * 打开文件对话框并从备份恢复学习数据。
     */
    importLearningData: () => backendClient.call('learning-data/import'),

    /**
     * 清除学习事件、复习卡与掌握字段；词表与用户状态保留。
     */
    resetLearningData: () => backendClient.call('learning-data/reset'),
};
