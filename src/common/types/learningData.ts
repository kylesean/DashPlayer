import type {
    ReviewCardState,
    ReviewRating,
    ReviewRetentionStats,
} from '@/common/types/review';
import type { ProductionPracticeMode, RetellLevel } from '@/common/types/learningRecap';
import type {
    WordEncounterAction,
    WordSource,
    WordStatus,
} from '@/common/types/vocabulary';
import type {
    ContentCompassAction,
    ContentCompassReason,
} from '@/common/types/contentCompass';

/**
 * 学习数据导出中的词条快照。
 */
export interface LearningDataWordVO {
    word: string;
    translate: string | null;
    status: WordStatus;
    source: WordSource;
    mastery: number;
    confidence: number;
    lastSeenAt: string | null;
    masteredAt: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * 学习数据导出中的遭遇事件。
 */
export interface LearningDataEncounterVO {
    id: number;
    word: string;
    lemma: string;
    action: WordEncounterAction;
    videoId: string | null;
    fileHash: string | null;
    sentenceIndex: number | null;
    sentenceHash: string | null;
    context: string | null;
    score: number | null;
    rating: ReviewRating | null;
    createdAt: string;
}

/**
 * 学习数据导出中的复习卡。
 */
export interface LearningDataReviewCardVO {
    word: string;
    dueAt: string;
    state: ReviewCardState;
    reps: number;
    lapses: number;
    stability: number;
    difficulty: number;
    lastReviewAt: string | null;
    lastRating: ReviewRating | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * 学习数据导出中的内容推荐事件。
 */
export interface LearningDataRecommendationVO {
    id: number;
    videoId: string;
    action: ContentCompassAction;
    surface: string;
    score: number;
    reasonCode: ContentCompassReason | null;
    createdAt: string;
}

/**
 * 学习数据导出中的跟读 / 听写记录。
 *
 * 与 `dp_sentence_practice_record` 一一对应；音频文件本身不写进 JSON，
 * 只保留相对路径，导入后仍需本机 practice 目录里存在同名文件才能回放。
 */
export interface LearningDataSentencePracticeVO {
    fileHash: string;
    sentenceIndex: number;
    resegmented: boolean;
    mode: string;
    score: number;
    transcript: string | null;
    audioFile: string | null;
    detailJson: string | null;
    createdAt: string;
}

/**
 * 学习数据导出中的复述 / 角色扮演记录。
 */
export interface LearningDataProductionPracticeVO {
    mode: ProductionPracticeMode;
    videoId: string | null;
    fileHash: string | null;
    sentenceIndex: number | null;
    sentenceText: string;
    responseText: string;
    level: RetellLevel;
    feedback: string | null;
    improved: string | null;
    detailJson: string | null;
    createdAt: string;
}

/**
 * 学习数据导出中的角色扮演轮次。
 *
 * 与 `dp_role_play_turn` 一一对应：同一场对话按轮次恢复，重开弹窗时才能
 * 看到完整的上下文中点评。
 */
export interface LearningDataRolePlayTurnVO {
    sessionKey: string;
    turn: number;
    videoId: string | null;
    fileHash: string | null;
    partnerLine: string;
    partnerIndex: number | null;
    responseText: string;
    level: RetellLevel;
    feedback: string | null;
    improved: string | null;
    usedExpressions: string[];
    source: string;
    createdAt: string;
}

/**
 * 可移植的学习数据 JSON。
 *
 * schemaVersion 1 只含词表 / 事件 / 复习卡 / 推荐；版本 2 起补齐了
 * 跟读、听写与产出型练习；版本 3 起补齐角色扮演轮次，导入时按版本兼容读取。
 */
export interface LearningDataExportVO {
    schemaVersion: 3;
    exportedAt: string;
    words: LearningDataWordVO[];
    encounters: LearningDataEncounterVO[];
    reviewCards: LearningDataReviewCardVO[];
    recommendations: LearningDataRecommendationVO[];
    sentencePractices: LearningDataSentencePracticeVO[];
    productionPractices: LearningDataProductionPracticeVO[];
    rolePlayTurns: LearningDataRolePlayTurnVO[];
    retention: {
        last7Days: ReviewRetentionStats;
        last30Days: ReviewRetentionStats;
    };
}

/**
 * 可写回本地库的学习数据快照。
 *
 * 与导出结构同形，去掉 schemaVersion / exportedAt / retention 等派生信息：
 * 这些字段用于展示与校验，不落库。
 */
export interface LearningDataRestoreSnapshot {
    words: LearningDataWordVO[];
    encounters: LearningDataEncounterVO[];
    reviewCards: LearningDataReviewCardVO[];
    recommendations: LearningDataRecommendationVO[];
    sentencePractices: LearningDataSentencePracticeVO[];
    productionPractices: LearningDataProductionPracticeVO[];
    rolePlayTurns: LearningDataRolePlayTurnVO[];
}

/**
 * 学习数据恢复后的各表记录数量。
 */
export interface LearningDataRestoreCounts {
    wordsRestored: number;
    encountersRestored: number;
    reviewCardsRestored: number;
    recommendationsRestored: number;
    sentencePracticesRestored: number;
    productionPracticesRestored: number;
    rolePlayTurnsRestored: number;
}

/**
 * 清除学习记录的结果；词表与用户状态不会被删除。
 */
export interface LearningDataResetResultVO {
    encountersDeleted: number;
    reviewCardsDeleted: number;
    recommendationsDeleted: number;
    rolePlayTurnsDeleted: number;
    wordsReset: number;
}

/**
 * 导出学习数据的返回结果。
 */
export interface LearningDataExportResultVO {
    success: boolean;
    canceled?: boolean;
    path?: string;
    bytes?: number;
    error?: string;
}

/**
 * 导入学习数据的返回结果。
 */
export interface LearningDataImportResultVO {
    success: boolean;
    canceled?: boolean;
    path?: string;
    /** 恢复的词条数。 */
    wordsRestored?: number;
    encountersRestored?: number;
    reviewCardsRestored?: number;
    recommendationsRestored?: number;
    sentencePracticesRestored?: number;
    productionPracticesRestored?: number;
    rolePlayTurnsRestored?: number;
    error?: string;
}
