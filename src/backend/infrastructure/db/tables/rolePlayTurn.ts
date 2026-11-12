import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import type { RetellLevel } from '@/common/types/learningRecap';

/**
 * 多轮场景对话的每一轮记录。
 *
 * 与 dp_production_practice_record 分开：那里存的是「一次练习」的最终结果，
 * 这里存的是同一场对话中每一轮的过程，重开弹窗时要按轮次原样恢复。
 *
 * 对方台词永远来自真实字幕，本表只存字幕序号与原文，不存模型生成的台词。
 */
export const rolePlayTurn = sqliteTable('dp_role_play_turn', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 会话键：按视频 + 开场白派生，同一会话的多轮共享。 */
    session_key: text('session_key').notNull(),
    /** 轮次序号，从 1 开始。 */
    turn: integer('turn').notNull(),
    /** 来源视频的观看历史 id；无法定位时为 null。 */
    video_id: text('video_id'),
    /** 字幕内容 hash；无法定位时为 null。 */
    file_hash: text('file_hash'),
    /** 对方台词（真实字幕原文）。 */
    partner_line: text('partner_line').notNull(),
    /** 对方台词在字幕中的序号；无法定位时为 null。 */
    partner_index: integer('partner_index'),
    /** 学习者这一轮的回应。 */
    response_text: text('response_text').notNull(),
    /** 等级：great | good | retry。 */
    level: text('level').$type<RetellLevel>().notNull(),
    /** 点评。 */
    feedback: text('feedback'),
    /** 更自然的说法。 */
    improved: text('improved'),
    /** 本轮用上的目标表达（JSON 序列化）。 */
    used_expressions_json: text('used_expressions_json'),
    /** 点评来源：ai | local。 */
    source: text('source').notNull(),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    sessionTurnIdx: index('idx_dp_role_play_turn_session_turn').on(table.session_key, table.turn),
}));

export type RolePlayTurn = typeof rolePlayTurn.$inferSelect;
export type InsertRolePlayTurn = typeof rolePlayTurn.$inferInsert;
