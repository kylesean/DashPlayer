import type { ReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import type { WordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import type { ReviewOutcome } from '@/backend/services/repositories/WordEncounterRepository';
import type { WordEncounterAction } from '@/common/types/vocabulary';

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
     * 删除遭遇事件与复习卡，并重置词条掌握字段。
     *
     * 在一个事务内完成，避免用户看到“记录已删但掌握度还在”的半清空状态。
     */
    resetLearningData(): Promise<LearningDataResetCounts>;
}
