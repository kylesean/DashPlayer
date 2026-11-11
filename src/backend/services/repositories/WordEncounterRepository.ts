import type { InsertWordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import type { ReviewRating } from '@/common/types/review';

/**
 * 复习窗口统计所需的一行结果。
 */
export interface ReviewOutcome {
    rating: ReviewRating | null;
    score: number | null;
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
}
