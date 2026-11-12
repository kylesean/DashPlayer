import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { SavedSentenceTag } from '@/common/types/contextStudio';

/**
 * 收藏金句表：存储用户在播放器或精读文稿中收藏的地道表达、难句与时间轴引用。
 *
 * 采用轻量元数据模型，直接记录 video_id 与起止时间戳，不再生成物理视频切片。
 */
export const savedSentence = sqliteTable('dp_saved_sentence', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 稳定句级主键：`${fileHash}:${sentenceIndex}` */
    sentence_key: text('sentence_key').notNull(),
    /** 所属视频 ID */
    video_id: text('video_id').notNull(),
    /** 视频标题冗余，用于离线展示出处 */
    video_title: text('video_title').notNull().default(''),
    /** 字幕内容哈希 */
    file_hash: text('file_hash').notNull(),
    /** 句子在字幕中的序号 */
    sentence_index: integer('sentence_index').notNull(),
    /** 开始时间（秒） */
    start_time: real('start_time').notNull().default(0),
    /** 结束时间（秒） */
    end_time: real('end_time').notNull().default(0),
    /** 英文原句 */
    text: text('text').notNull(),
    /** 中文译文 */
    text_zh: text('text_zh').notNull().default(''),
    /** 用户学习笔记 */
    note: text('note').notNull().default(''),
    /** 分类标签 */
    tag: text('tag').$type<SavedSentenceTag>().notNull().default('general'),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    sentenceKeyUq: uniqueIndex('uq_dp_saved_sentence_key').on(table.sentence_key),
    videoIdx: index('idx_dp_saved_sentence_video').on(table.video_id),
    createdIdx: index('idx_dp_saved_sentence_created').on(table.created_at),
}));

export type SavedSentenceRow = typeof savedSentence.$inferSelect;
export type InsertSavedSentenceRow = typeof savedSentence.$inferInsert;
