import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * 整句学习教学人设与自定义 System Prompt 预设表。
 *
 * 内置预设以只读默认模板为基础，用户对其修改后会以同 `preset_id` 覆盖存表，
 * 支持单条一键恢复出厂默认，也支持新增私人教学预设。
 */
export const learningPromptPreset = sqliteTable('dp_learning_prompt_preset', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    preset_id: text('preset_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** study | tutor | listening | custom */
    role_mode: text('role_mode').notNull().default('custom'),
    system_prompt: text('system_prompt').notNull(),
    is_builtin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
    sort_order: integer('sort_order').notNull().default(100),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    presetIdUq: uniqueIndex('uq_dp_learning_prompt_preset_id').on(table.preset_id),
}));

export type LearningPromptPresetRow = typeof learningPromptPreset.$inferSelect;
export type InsertLearningPromptPresetRow = typeof learningPromptPreset.$inferInsert;
