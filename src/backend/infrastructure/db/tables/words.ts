import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { WordSource, WordStatus } from '@/common/types/vocabulary';

export const words = sqliteTable('dp_words', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    word: text('word').notNull().unique(),
    /**
     * 历史遗留字段；新逻辑请勿继续依赖。
     */
    stem: text('stem'),
    translate: text('translate'),
    /**
     * 历史遗留字段；新逻辑请勿继续依赖。
     */
    note: text('note'),
    /**
     * 学习状态：learning / familiar / known / ignored。
     * 字幕标注只读取活跃状态，默认词表以 ignored 存在，避免污染正文。
     */
    status: text('status').$type<WordStatus>().notNull().default('learning'),
    /**
     * 状态来源：manual / imported / default / suggested / legacy。
     */
    source: text('source').$type<WordSource>().notNull().default('manual'),
    /** 掌握概率 0-1；R0 先落字段，R1 由证据事件更新。 */
    mastery: real('mastery').notNull().default(0),
    /** 掌握度置信度 0-1。 */
    confidence: real('confidence').notNull().default(0),
    /** 最近一次在播放器中遇见的时间。 */
    last_seen_at: text('last_seen_at'),
    /** 用户确认已掌握的时间。 */
    mastered_at: text('mastered_at'),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    lowerWordIdx: index('dp_words_lower_word_idx').on(sql`lower(${table.word})`),
    statusSourceIdx: index('dp_words_status_source_idx').on(table.status, table.source),
}));

export type Word = typeof words.$inferSelect; // return type when queried
export type InsertWord = typeof words.$inferInsert; // insert type
