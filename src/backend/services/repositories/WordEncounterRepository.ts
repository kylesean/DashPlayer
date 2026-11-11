import type { InsertWordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import type { ReviewRating } from '@/common/types/review';
import type { WordEncounterAction } from '@/common/types/vocabulary';

/**
 * 复习窗口统计所需的一行结果。
 */
export interface ReviewOutcome {
    rating: ReviewRating | null;
    score: number | null;
}

/**
 * 推荐评分所需的一条轻量行为记录。
 */
export interface EncounterActionRow {
    lemma: string;
    action: WordEncounterAction;
    createdAt: string;
}

/**
 * 复习卡展示语境所需的一次带字幕句的遭遇。
 */
export interface EncounterContextRow {
    lemma: string;
    /** 字幕原句。 */
    text: string;
    videoId: string | null;
    videoFileName: string | null;
    sentenceIndex: number | null;
    sentenceHash: string | null;
    createdAt: string;
}

/**
 * 单词遭遇事件仓储。
 */
export default interface WordEncounterRepository {
    /**
     * 追加一条遭遇事件。
     *
     * @param value 事件内容。
     */
    record(value: InsertWordEncounter): Promise<void>;

    /**
     * 查询某时间之后的复习结果。
     */
    listReviewOutcomesSince(since: string): Promise<ReviewOutcome[]>;

    /**
     * 查询某时间之后指定动作的轻量行为记录。
     *
     * 用于推荐评分中的「之前查过 / 收藏过 / 忽略过」，避免逐词查询事件表。
     */
    listActionsSince(
        since: string,
        actions: readonly WordEncounterAction[],
    ): Promise<EncounterActionRow[]>;

    /**
     * 批量查询每个词最近一次带字幕原句的遭遇。
     *
     * 只返回带 context 的事件：复习卡要靠它还原「在哪个视频的哪句话里见过」。
     */
    findLatestContexts(lemmas: string[]): Promise<EncounterContextRow[]>;
}
