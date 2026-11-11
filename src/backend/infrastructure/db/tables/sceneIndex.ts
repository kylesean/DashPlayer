import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * 场景切分索引。
 *
 * 一行代表「某个字幕文件在某个切分算法版本下的场景边界结果」。切分是纯本地的
 * 确定性启发式，同一份字幕每次结果都一样，所以缓存的是输入指纹而不是时间：
 * 字幕内容变了（重新切分、时间轴校准）指纹就变，旧结果自然失效。
 *
 * 用算法版本参与唯一键，是为了让调整阈值后能自动重算，而不是读到旧阈值的
 * 结果却以为已经是最新。
 */
export const sceneIndex = sqliteTable('dp_scene_index', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 字幕内容哈希；与 Sentence.fileHash 一致。 */
    file_hash: text('file_hash').notNull(),
    /** 切分算法版本；阈值或信号变化时递增。 */
    algorithm_version: integer('algorithm_version').notNull(),
    /** 输入指纹：字幕文本与时间的哈希，用于判断是否需要重算。 */
    input_hash: text('input_hash').notNull(),
    /** 边界数组的 JSON；规模是每部字幕几十条，不需要拆表。 */
    boundaries_json: text('boundaries_json').notNull(),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    fileVersionIdx: uniqueIndex('dp_scene_index_file_version_idx')
        .on(table.file_hash, table.algorithm_version),
}));

export type SceneIndexRow = typeof sceneIndex.$inferSelect;
export type InsertSceneIndex = typeof sceneIndex.$inferInsert;
