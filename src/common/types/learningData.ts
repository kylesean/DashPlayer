import type {
    ReviewCardState,
    ReviewRating,
    ReviewRetentionStats,
} from '@/common/types/review';
import type {
    WordEncounterAction,
    WordSource,
    WordStatus,
} from '@/common/types/vocabulary';

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
 * 可移植的学习数据 JSON。
 */
export interface LearningDataExportVO {
    schemaVersion: 1;
    exportedAt: string;
    words: LearningDataWordVO[];
    encounters: LearningDataEncounterVO[];
    reviewCards: LearningDataReviewCardVO[];
    retention: {
        last7Days: ReviewRetentionStats;
        last30Days: ReviewRetentionStats;
    };
}

/**
 * 清除学习记录的结果；词表与用户状态不会被删除。
 */
export interface LearningDataResetResultVO {
    encountersDeleted: number;
    reviewCardsDeleted: number;
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
