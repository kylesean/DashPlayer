import type { WordEncounterAction, WordStatus } from '@/common/types/vocabulary';

/**
 * 本次学习会话摘要的查询参数。
 *
 * videoId 与 fileHash 至少有其一；两者都缺失时返回空摘要。
 */
export interface LearningSessionSummaryParams {
    videoId?: string;
    fileHash?: string;
    /** 会话开始时间（ISO 8601）。 */
    since: string;
    /** 最多返回多少个最近遇见的目标词。 */
    limit?: number;
}

/**
 * 会话中一个目标词的学习快照。
 */
export interface LearningSessionWordVO {
    word: string;
    translate: string | null;
    status: WordStatus;
    mastery: number;
    confidence: number;
    /** 本次会话里发生过的学习动作。 */
    actions: WordEncounterAction[];
    /** 最近一次遇见时间。 */
    lastSeenAt: string;
    /** 当前已到期时携带到期时间；未到期或没有卡时为 null。 */
    dueAt: string | null;
}

/**
 * 播放器内“本次学习”摘要。
 */
export interface LearningSessionSummaryVO {
    since: string;
    counts: {
        /** 本次遇见的目标词数（去重、排除默认词表与已忽略词）。 */
        encountered: number;
        /** 本次手动标记为已掌握的词数。 */
        mastered: number;
        /** 本次遇见且当前到期的词数。 */
        due: number;
        /** 跟读/听写事件次数。 */
        practice: number;
    };
    /** 最近遇见的目标词，按最近遇见时间倒序。 */
    words: LearningSessionWordVO[];
    /** 本次已掌握的词，按最近遇见时间倒序。 */
    mastered: LearningSessionWordVO[];
    /** 当前到期的词，按到期时间升序。 */
    due: LearningSessionWordVO[];
    /** 本次遇见词中最早的下一次到期时间；没有卡时为 null。 */
    nextDueAt: string | null;
}
