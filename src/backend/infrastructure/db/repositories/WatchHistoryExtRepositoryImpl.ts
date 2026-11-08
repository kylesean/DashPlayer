import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import { watchHistoryExt } from '@/backend/infrastructure/db/tables/watchHistoryExt';
import TYPES from '@/backend/ioc/types';
import type WatchHistoryExtRepository from '@/backend/services/repositories/WatchHistoryExtRepository';
import { type WatchHistoryExtPatch, type WatchHistoryExtRecord } from '@/backend/services/repositories/WatchHistoryExtRepository';

/**
 * 观看历史扩展字段仓储实现。
 */
@injectable()
export default class WatchHistoryExtRepositoryImpl implements WatchHistoryExtRepository {
    /**
     * 初始化观看历史扩展仓储实例。
     *
     * @param db 由依赖容器注入的数据库实例，测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async findByWatchHistoryId(watchHistoryId: string): Promise<WatchHistoryExtRecord | null> {
        const rows = await this.db
            .select()
            .from(watchHistoryExt)
            .where(eq(watchHistoryExt.watch_history_id, watchHistoryId))
            .limit(1);
        const row = rows[0];
        return row
            ? {
                podcast_mode_user_set: row.podcast_mode_user_set,
                podcast_mode_manual: row.podcast_mode_manual,
            }
            : null;
    }

    public async upsert(watchHistoryId: string, patch: WatchHistoryExtPatch): Promise<WatchHistoryExtRecord> {
        const rows = await this.db
            .insert(watchHistoryExt)
            .values({ watch_history_id: watchHistoryId, ...patch })
            .onConflictDoUpdate({
                target: watchHistoryExt.watch_history_id,
                set: patch,
            })
            .returning();
        const row = rows[0];
        if (!row) {
            throw new Error('upsert watch history ext failed');
        }
        return {
            podcast_mode_user_set: row.podcast_mode_user_set,
            podcast_mode_manual: row.podcast_mode_manual,
        };
    }

    public async deleteByWatchHistoryId(watchHistoryId: string): Promise<void> {
        await this.db
            .delete(watchHistoryExt)
            .where(eq(watchHistoryExt.watch_history_id, watchHistoryId));
    }
}
