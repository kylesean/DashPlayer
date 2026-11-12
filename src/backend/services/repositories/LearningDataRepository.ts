import type {
    InsertRecommendationEvent,
    RecommendationEvent,
} from '@/backend/infrastructure/db/tables/recommendationEvent';
import type { WordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import type { ReviewOutcome } from '@/backend/services/repositories/WordEncounterRepository';
import type { ReviewEventRow } from '@/common/types/review';
import type { WordEncounterAction } from '@/common/types/vocabulary';
import type {
    LearningDataRestoreCounts,
    LearningDataRestoreSnapshot,
} from '@/common/types/learningData';
import type { ReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import type { ProductionPracticeRecord } from '@/backend/infrastructure/db/tables/productionPracticeRecord';
import type { SentencePracticeRecord } from '@/backend/infrastructure/db/tables/sentencePracticeRecord';

/**
 * 会话摘要需要的事件查询条件。
 */
export interface SessionEventQuery {
    /** 会话开始时间。 */
    since: string;
    videoId?: string;
    fileHash?: string;
    actions: readonly WordEncounterAction[];
    /** 防御性上限，避免异常时间窗把整张事件表读入内存。 */
    limit?: number;
}

/**
 * 清除学习记录的实际删除数量。
 */
export interface LearningDataResetCounts {
    encountersDeleted: number;
    reviewCardsDeleted: number;
    recommendationsDeleted: number;
    wordsReset: number;
}

/**
 * 学习数据导出、会话摘要与清除所需的只读/维护仓储。
 *
 * 这些查询跨越词表、遭遇事件与复习卡三张表，独立成仓储可以避免把导出职责
 * 塞进面向播放链路的单个仓储接口里。
 */
export default interface LearningDataRepository {
    /** 读取用户词表；默认词表不属于用户学习数据。 */
    listUserWords(): Promise<Word[]>;

    /**
     * 读取用户词表的原始证据值（mastery 不经读取边界衰减），供可移植导出使用；
     * 用衰减后的值落备份会让每次备份往返都额外衰减一次。
     */
    listUserWordsForExport(): Promise<Word[]>;

    /** 读取全部遭遇事件，按写入顺序升序。 */
    listEncounters(): Promise<WordEncounter[]>;

    /** 读取全部复习卡。 */
    listReviewCards(): Promise<ReviewCard[]>;

    /** 查询某个视频/字幕在会话开始后的学习事件。 */
    listSessionEvents(query: SessionEventQuery): Promise<WordEncounter[]>;

    /** 按 lemma 批量读取词条。 */
    findWordsByLemmas(lemmas: string[]): Promise<Word[]>;

    /** 按 lemma 批量读取复习卡。 */
    findReviewCardsByWords(words: string[]): Promise<ReviewCard[]>;

    /** 查询某时间之后的复习结果，用于导出 7/30 天指标。 */
    listReviewOutcomesSince(since: string): Promise<ReviewOutcome[]>;

    /**
     * 查询某时间之后的复习事件，带上 lemma 与评级。
     *
     * 北极星指标要按「词」去重，而 `listReviewOutcomesSince` 只返回评级与分数，
     * 无法区分是不是同一个词，因此单独提供带 lemma 的窗口查询。
     */
    listReviewEventsSince(since: string): Promise<ReviewEventRow[]>;

    /**
     * 查询某时间之后的学习事件，用于按窗口统计反馈率与练习覆盖。
     */
    listEncountersSince(since: string): Promise<WordEncounter[]>;

    /** 写入一条内容指南针曝光或反馈事件。 */
    insertRecommendationEvent(value: InsertRecommendationEvent): Promise<void>;

    /** 查询指定时间后的推荐事件，按写入顺序升序。 */
    listRecommendationEventsSince(since: string, limit?: number): Promise<RecommendationEvent[]>;

    /** 读取全部推荐事件，用于可移植导出。 */
    listRecommendationEvents(): Promise<RecommendationEvent[]>;

    /** 读取全部跟读 / 听写记录，用于可移植导出。 */
    listSentencePracticeRecords(): Promise<SentencePracticeRecord[]>;

    /** 读取全部复述 / 角色扮演记录，用于可移植导出。 */
    listProductionPracticeRecords(): Promise<ProductionPracticeRecord[]>;

    /**
     * 删除遭遇事件、复习卡、推荐事件与练习记录，并重置词条掌握字段。
     *
     * 在一个事务内完成，避免用户看到“记录已删但掌握度还在”的半清空状态。
     */
    resetLearningData(): Promise<LearningDataResetCounts>;

    /**
     * 把一份导出的学习数据写回本地库。
     *
     * 与导出对称：先清空事件类数据，再按导出快照恢复词条状态、事件、复习卡、
     * 推荐事件与练习记录。整个过程在一个事务内完成，失败时整体回滚。
     *
     * @param snapshot 已完成结构校验的导出快照。
     * @returns 恢复后的各表记录数量。
     */
    restoreLearningData(snapshot: LearningDataRestoreSnapshot): Promise<LearningDataRestoreCounts>;
}
