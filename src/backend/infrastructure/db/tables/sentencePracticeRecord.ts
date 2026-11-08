import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * 句子练习记录表:跟读(录音转写)与听写(键入)的每一次评分落库,
 * 供练习面板展示历史成绩与进步曲线。
 */
export const sentencePracticeRecord = sqliteTable('dp_sentence_practice_record', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /**
     * 字幕内容 hash(Sentence.fileHash),定位到具体视频
     */
    file_hash: text('file_hash').notNull(),
    /**
     * 意群在字幕中的序号(Sentence.index)
     */
    sentence_index: integer('sentence_index').notNull(),
    /**
     * 练习模式:shadowing(跟读) | dictation(听写)
     */
    mode: text('mode').notNull(),
    /**
     * 评分 0-100
     */
    score: real('score').notNull(),
    /**
     * 语音转写文本或听写输入;转写失败时为 null
     */
    transcript: text('transcript'),
    /**
     * 逐词对齐结果(JSON 序列化的 SentencePracticeWordResult[])
     */
    detail_json: text('detail_json'),
    /**
     * 创建时间
     */
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    // 按视频 + 意群查历史是最热路径
    fileSentenceIdx: index('idx_dp_sentence_practice_record_file_sentence').on(table.file_hash, table.sentence_index)
}));

export type SentencePracticeRecord = typeof sentencePracticeRecord.$inferSelect;
export type InsertSentencePracticeRecord = typeof sentencePracticeRecord.$inferInsert;
