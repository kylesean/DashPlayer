import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * 整句学习记忆表：按句持久化的结构化精读首卡缓存、用户笔记摘要与多轮对话历史。
 *
 * 离开学习页或上下句切换后再回到同一句时秒开缓存，不丢失学习沉淀与追问上下文。
 */
export const sentenceStudyNote = sqliteTable('dp_sentence_study_note', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 稳定句级主键：`${fileHash}:${sentenceIndex}` */
    sentence_key: text('sentence_key').notNull(),
    video_id: text('video_id').notNull(),
    file_hash: text('file_hash').notNull(),
    sentence_index: integer('sentence_index').notNull(),
    original_text: text('original_text').notNull(),
    /** JSON 序列化的 SentenceStudyCard，未生成或仅手动记笔记时可为 null */
    study_card_json: text('study_card_json'),
    /** 用户编辑/收藏的本句精读笔记摘要 */
    note_summary: text('note_summary').notNull().default(''),
    /** JSON 序列化的 PersistedChatMessage[] */
    messages_json: text('messages_json').notNull().default('[]'),
    /** 最近一次互动使用的教学预设 ID */
    preset_id: text('preset_id'),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    sentenceKeyUq: uniqueIndex('uq_dp_sentence_study_note_key').on(table.sentence_key),
    fileSentenceIdx: index('idx_dp_sentence_study_note_file_sentence').on(table.file_hash, table.sentence_index),
}));

export type SentenceStudyNoteRow = typeof sentenceStudyNote.$inferSelect;
export type InsertSentenceStudyNoteRow = typeof sentenceStudyNote.$inferInsert;
