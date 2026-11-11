import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ReviewRating } from '@/common/types/review';
import type { WordEncounterAction } from '@/common/types/vocabulary';

/**
 * 单词遭遇事件。
 *
 * 事件流而不是单个 mastery 数字：之后可以重算掌握度、推荐理由和复习计划，
 * 不会因为一次状态覆盖而丢掉用户与词的真实交互历史。
 */
export const wordEncounter = sqliteTable('dp_word_encounter', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 句中实际词形。 */
    word: text('word').notNull(),
    /** 归一化后的 lemma。 */
    lemma: text('lemma').notNull(),
    /** 用户行为。 */
    action: text('action').$type<WordEncounterAction>().notNull(),
    /** 当前播放视频标识。 */
    video_id: text('video_id'),
    /** 字幕内容哈希。 */
    file_hash: text('file_hash'),
    /** 句内序号。 */
    sentence_index: integer('sentence_index'),
    /** 句子内容哈希。 */
    sentence_hash: text('sentence_hash'),
    /** 句子上下文，供后续解释/复习回忆。 */
    context: text('context'),
    /** 跟读/听写得分 0-100；不适用时为 null。 */
    score: real('score'),
    /** 复习反馈；不适用时为 null。 */
    rating: text('rating').$type<ReviewRating>(),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    lemmaIdx: index('dp_word_encounter_lemma_idx').on(table.lemma),
    createdIdx: index('dp_word_encounter_created_idx').on(table.created_at),
}));

export type WordEncounter = typeof wordEncounter.$inferSelect;
export type InsertWordEncounter = typeof wordEncounter.$inferInsert;
