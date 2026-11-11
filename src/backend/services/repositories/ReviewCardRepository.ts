import type { InsertReviewCard, ReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import type { Word } from '@/backend/infrastructure/db/tables/words';

/**
 * 到期复习卡及其词条信息。
 */
export interface DueReviewCard {
    card: ReviewCard;
    word: Word;
}

/**
 * 复习卡仓储。
 */
export default interface ReviewCardRepository {
    /**
     * 按 lemma 查卡；不存在时返回 null。
     */
    findByWord(word: string): Promise<ReviewCard | null>;

    /**
     * 写入或覆盖一张卡；word 是唯一业务键。
     */
    upsert(value: InsertReviewCard): Promise<void>;

    /**
     * 查询到期卡，并只返回活跃（learning / familiar）且非默认词表的词条。
     */
    listDue(now: string, limit: number): Promise<DueReviewCard[]>;

    /**
     * 统计到期卡数量；过滤条件与 listDue 保持一致。
     */
    countDue(now: string): Promise<number>;

    /**
     * 查询下一张活跃卡的到期时间；没有卡时返回 null。
     */
    nextDueAt(): Promise<string | null>;

    /**
     * 删除某个词的卡。
     */
    deleteByWord(word: string): Promise<void>;
}
