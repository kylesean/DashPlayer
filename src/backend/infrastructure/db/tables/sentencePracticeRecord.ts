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
     * 记录是否在意群重切分行上产生;与 (file_hash, sentence_index) 共同构成查询键,
     * 重切分开关切换后序号含义整体重排,键里缺开关状态会让历史挂到另一句话上。
     * 修复前无此列:重切分默认开启,列默认 true 以保留存量历史的可见性。
     */
    resegmented: integer('resegmented', { mode: 'boolean' }).notNull().default(true),
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
     * 跟读录音 webm 在 practice 目录下的相对路径;听写记录为 null
     */
    audio_file: text('audio_file'),
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
