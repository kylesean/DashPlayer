import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import type {
    ContentCompassAction,
    ContentCompassReason,
} from '@/common/types/contentCompass';

/**
 * 内容指南针的曝光与用户反馈事件。
 *
 * 推荐事件与词表、遭遇事件分表存放，推荐结果不能反向污染用户学习状态。
 */
export const recommendationEvent = sqliteTable('dp_recommendation_event', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    video_id: text('video_id').notNull(),
    action: text('action').$type<ContentCompassAction>().notNull(),
    surface: text('surface').notNull().default('home'),
    score: real('score').notNull().default(0),
    reason_code: text('reason_code').$type<ContentCompassReason>(),
    created_at: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    videoCreatedIdx: index('dp_recommendation_event_video_created_idx')
        .on(table.video_id, table.created_at),
    createdAtIdx: index('dp_recommendation_event_created_idx').on(table.created_at),
}));

export type RecommendationEvent = typeof recommendationEvent.$inferSelect;
export type InsertRecommendationEvent = typeof recommendationEvent.$inferInsert;
