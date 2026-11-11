import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import type { ProductionPracticeMode, RetellLevel } from '@/common/types/learningRecap';

/**
 * 产出型练习记录表：复述与角色扮演的每一次评分落库。
 *
 * 与 dp_sentence_practice_record 分开存放：跟读/听写衡量的是「说/写得对不对」，
 * 复述/角色扮演衡量的是「能不能自己组织表达」，两者的分值不可互相平均。
 */
export const productionPracticeRecord = sqliteTable('dp_production_practice_record', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 练习模式：retell(复述) | roleplay(角色扮演) */
    mode: text('mode').$type<ProductionPracticeMode>().notNull(),
    /** 来源视频的观看历史 id；无法定位时为 null */
    video_id: text('video_id'),
    /** 字幕内容 hash；无法定位时为 null */
    file_hash: text('file_hash'),
    /** 句在字幕中的序号；无法定位时为 null */
    sentence_index: integer('sentence_index'),
    /** 复述原句或角色扮演开场白 */
    sentence_text: text('sentence_text').notNull(),
    /** 用户输入的回答 */
    response_text: text('response_text').notNull(),
    /** 等级：great | good | retry */
    level: text('level').$type<RetellLevel>().notNull(),
    /** 点评 */
    feedback: text('feedback'),
    /** 更自然的说法 */
    improved: text('improved'),
    /** 本地计算的覆盖信息（JSON 序列化） */
    detail_json: text('detail_json'),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    // 复盘弹窗按视频查「上次结果」是最热路径
    fileCreatedIdx: index('idx_dp_production_practice_record_file_created').on(table.file_hash, table.created_at),
}));

export type ProductionPracticeRecord = typeof productionPracticeRecord.$inferSelect;
export type InsertProductionPracticeRecord = typeof productionPracticeRecord.$inferInsert;
