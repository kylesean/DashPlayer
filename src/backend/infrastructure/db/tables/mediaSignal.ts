import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * 视频级派生信号。
 *
 * 一行代表「某个视频的某类信号在某个算法版本下的结果」。信号来自对视频本体
 * 的分析（声纹分段、关键帧理解），代价远高于字幕启发式，因此必须跨会话持久化，
 * 否则每次进播放页都要重新解码整部视频。
 *
 * `kind` 而不是给每类信号建一张表：信号之间共享「按视频 + 版本缓存」的生命周期，
 * 拆表只会让清理与失效逻辑重复三遍。载荷结构由 kind 决定，读端按 kind 校验。
 */
export const mediaSignal = sqliteTable('dp_media_signal', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 视频路径；与观看记录一致。 */
    video_id: text('video_id').notNull(),
    /** 信号类型：`speaker-segments`（声纹分段）/ `visual-scenes`（画面切分）。 */
    kind: text('kind').notNull(),
    /** 算法版本；阈值或模型变化时递增，旧结果自然失效。 */
    algorithm_version: integer('algorithm_version').notNull(),
    /** 输入指纹：视频路径 + 大小 + 修改时间的哈希，视频被替换时失效。 */
    input_hash: text('input_hash').notNull(),
    /** 信号载荷的 JSON；规模是每部视频几十到几百条，不需要拆表。 */
    payload_json: text('payload_json').notNull(),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    videoKindVersionIdx: uniqueIndex('dp_media_signal_video_kind_version_idx')
        .on(table.video_id, table.kind, table.algorithm_version),
}));

export type MediaSignalRow = typeof mediaSignal.$inferSelect;
export type InsertMediaSignal = typeof mediaSignal.$inferInsert;
