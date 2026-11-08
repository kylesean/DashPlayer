import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import TYPES from '@/backend/ioc/types';
import type SubtitleTimestampAdjustmentsRepository from '@/backend/services/repositories/SubtitleTimestampAdjustmentsRepository';
import {
    type InsertSubtitleTimestampAdjustment,
    type SubtitleTimestampAdjustmentRow,
    subtitleTimestampAdjustments,
} from '@/backend/infrastructure/db/tables/subtitleTimestampAdjustment';
import type {
    SubtitleTimestampAdjustment,
    SubtitleTimestampAdjustmentInput,
} from '@/common/contracts/subtitle-timestamp-adjustment';
import TimeUtil from '@/common/utils/TimeUtil';

/**
 * 字幕时间戳微调仓储实现。
 */
@injectable()
export default class SubtitleTimestampAdjustmentsRepositoryImpl implements SubtitleTimestampAdjustmentsRepository {
    /**
     * 初始化字幕时间戳微调仓储实例。
     *
     * @param db 由依赖容器注入的数据库实例，测试中可替换为内存库。
     */
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    /**
     * 新增或覆盖字幕时间调整记录。
     *
     * @param values 业务层提交的调整字段。
     */
    public async upsert(values: SubtitleTimestampAdjustmentInput): Promise<void> {
        await this.db
            .insert(subtitleTimestampAdjustments)
            .values(values satisfies InsertSubtitleTimestampAdjustment)
            .onConflictDoUpdate({
                target: subtitleTimestampAdjustments.key,
                set: {
                    subtitle_path: values.subtitle_path,
                    start_at: values.start_at,
                    end_at: values.end_at,
                    updated_at: TimeUtil.timeUtc(),
                },
            });
    }

    public async deleteByKey(key: string): Promise<void> {
        await this.db
            .delete(subtitleTimestampAdjustments)
            .where(eq(subtitleTimestampAdjustments.key, key));
    }

    public async deleteByFileHash(fileHash: string): Promise<void> {
        await this.db
            .delete(subtitleTimestampAdjustments)
            .where(eq(subtitleTimestampAdjustments.subtitle_hash, fileHash));
    }

    public async findByKey(key: string): Promise<SubtitleTimestampAdjustment | undefined> {
        const values: SubtitleTimestampAdjustmentRow[] = await this.db
            .select()
            .from(subtitleTimestampAdjustments)
            .where(eq(subtitleTimestampAdjustments.key, key))
            .limit(1);
        return values[0];
    }

    public async findByPath(subtitlePath: string): Promise<SubtitleTimestampAdjustment[]> {
        const values: SubtitleTimestampAdjustmentRow[] = await this.db
            .select()
            .from(subtitleTimestampAdjustments)
            .where(eq(subtitleTimestampAdjustments.subtitle_path, subtitlePath));
        return values;
    }

    public async findByHash(hash: string): Promise<SubtitleTimestampAdjustment[]> {
        const values: SubtitleTimestampAdjustmentRow[] = await this.db
            .select()
            .from(subtitleTimestampAdjustments)
            .where(eq(subtitleTimestampAdjustments.subtitle_hash, hash));
        return values;
    }
}
