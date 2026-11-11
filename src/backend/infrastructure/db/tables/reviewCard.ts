import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ReviewCardState, ReviewRating } from '@/common/types/review';

/**
 * 单词复习卡。
 *
 * 一张卡只服务一个 lemma；调度状态与词条释义分开，
 * 删除词条后卡可以被安全清理或忽略。
 */
export const reviewCard = sqliteTable('dp_review_card', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** canonical lemma，小写。 */
    word: text('word').notNull().unique(),
    /** 下次到期时间。 */
    due_at: text('due_at').notNull(),
    /** 调度阶段。 */
    state: text('state').$type<ReviewCardState>().notNull().default('new'),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    /** 记忆稳定度，单位天。 */
    stability: real('stability').notNull().default(0),
    /** 难度 1-10。 */
    difficulty: real('difficulty').notNull().default(0),
    last_review_at: text('last_review_at'),
    last_rating: text('last_rating').$type<ReviewRating>(),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    dueIdx: index('dp_review_card_due_idx').on(table.due_at),
}));

export type ReviewCard = typeof reviewCard.$inferSelect;
export type InsertReviewCard = typeof reviewCard.$inferInsert;
