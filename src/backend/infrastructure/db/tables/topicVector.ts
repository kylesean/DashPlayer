import { customType, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * SQLite BLOB 列。
 *
 * drizzle 0.35 的 sqlite `text()` 不支持 `mode: 'blob'`，用 customType 显式声明；
 * 读写都按 Buffer 处理，避免驱动把二进制当 UTF-8 文本截断。
 */
const blob = customType<{ data: Buffer; driverData: Buffer }>({
    dataType() {
        return 'blob';
    },
});

/**
 * 主题向量索引条目。
 *
 * 一行代表「某个视频在某个模型下的主题向量」。向量本身以 Float32 小端字节
 * 存进 BLOB，而不是 JSON 文本：768 维的 JSON 约 9 KB，Float32 只要 3 KB，
 * 且反序列化不需要逐字符解析。
 *
 * 一个视频可能同时存在多个模型的向量（例如用户从 bge-small 换到
 * EmbeddingGemma 2），检索时按 model 过滤，绝不让不同空间的向量互相比较。
 */
export const topicVector = sqliteTable('dp_topic_vector', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 视频路径；与观看记录一致。 */
    video_id: text('video_id').notNull(),
    /** 生成向量的模型标识，含量化档位，用于隔离不同向量空间。 */
    model: text('model').notNull(),
    /** 向量维度；读取时校验，避免截断或错位。 */
    dimension: integer('dimension').notNull(),
    /** Float32 小端字节。 */
    vector: blob('vector').notNull(),
    /** 生成向量所用的主题文本哈希；文本没变就不必重新推理。 */
    text_hash: text('text_hash').notNull(),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    /** 同一视频 + 同一模型只保留一条；增量更新按这个唯一键命中。 */
    videoModelIdx: uniqueIndex('dp_topic_vector_video_model_idx').on(table.video_id, table.model),
}));

export type TopicVectorRow = typeof topicVector.$inferSelect;
export type InsertTopicVector = typeof topicVector.$inferInsert;
