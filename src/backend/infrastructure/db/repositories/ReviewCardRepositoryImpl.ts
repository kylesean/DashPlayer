import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    type InsertReviewCard,
    reviewCard,
    type ReviewCard,
} from '@/backend/infrastructure/db/tables/reviewCard';
import { words, type Word } from '@/backend/infrastructure/db/tables/words';
import TYPES from '@/backend/ioc/types';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import { ACTIVE_WORD_STATUSES } from '@/common/types/vocabulary';

/**
 * 复习卡 SQLite 仓储。
 */
@injectable()
export default class ReviewCardRepositoryImpl implements ReviewCardRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async findByWord(word: string): Promise<ReviewCard | null> {
        const rows = await this.db
            .select()
            .from(reviewCard)
            .where(eq(reviewCard.word, word.toLowerCase()))
            .limit(1);
        return rows[0] ?? null;
    }

    public async upsert(value: InsertReviewCard): Promise<void> {
        const now = new Date().toISOString();
        this.db.insert(reviewCard)
            .values({
                ...value,
                created_at: value.created_at ?? now,
                updated_at: now,
            })
            .onConflictDoUpdate({
                target: reviewCard.word,
                set: {
                    due_at: value.due_at,
                    state: value.state,
                    reps: value.reps,
                    lapses: value.lapses,
                    stability: value.stability,
                    difficulty: value.difficulty,
                    last_review_at: value.last_review_at,
                    last_rating: value.last_rating,
                    updated_at: now,
                },
            })
            .run();
    }

    public async listDue(now: string, limit: number): Promise<{ card: ReviewCard; word: Word }[]> {
        return this.db
            .select({ card: reviewCard, word: words })
            .from(reviewCard)
            .innerJoin(words, eq(sql`lower(${words.word})`, reviewCard.word))
            .where(and(
                lte(reviewCard.due_at, now),
                inArray(words.status, [...ACTIVE_WORD_STATUSES]),
                ne(words.source, 'default'),
            ))
            .orderBy(asc(reviewCard.due_at))
            .limit(limit);
    }

    public async countDue(now: string): Promise<number> {
        const rows = await this.db
            .select({ count: sql<number>`count(*)` })
            .from(reviewCard)
            .innerJoin(words, eq(sql`lower(${words.word})`, reviewCard.word))
            .where(and(
                lte(reviewCard.due_at, now),
                inArray(words.status, [...ACTIVE_WORD_STATUSES]),
                ne(words.source, 'default'),
            ));
        return Number(rows[0]?.count ?? 0);
    }

    public async nextDueAt(): Promise<string | null> {
        const rows = await this.db
            .select({ dueAt: sql<string | null>`min(${reviewCard.due_at})` })
            .from(reviewCard)
            .innerJoin(words, eq(sql`lower(${words.word})`, reviewCard.word))
            .where(and(
                inArray(words.status, [...ACTIVE_WORD_STATUSES]),
                ne(words.source, 'default'),
            ));
        return rows[0]?.dueAt ?? null;
    }

    public async deleteByWord(word: string): Promise<void> {
        this.db.delete(reviewCard).where(eq(reviewCard.word, word.toLowerCase())).run();
    }
}
