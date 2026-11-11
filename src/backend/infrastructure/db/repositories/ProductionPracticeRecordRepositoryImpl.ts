import { desc, eq, or } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    type InsertProductionPracticeRecord,
    productionPracticeRecord,
    type ProductionPracticeRecord,
} from '@/backend/infrastructure/db/tables/productionPracticeRecord';
import type ProductionPracticeRecordRepository from '@/backend/services/repositories/ProductionPracticeRecordRepository';

/**
 * 产出型练习记录仓储实现。
 */
@injectable()
export default class ProductionPracticeRecordRepositoryImpl implements ProductionPracticeRecordRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async insertOne(value: InsertProductionPracticeRecord): Promise<number> {
        const [record] = await this.db
            .insert(productionPracticeRecord)
            .values(value)
            .returning({ id: productionPracticeRecord.id });
        return record.id;
    }

    public async listRecentByLocation(location: {
        videoId?: string;
        fileHash?: string;
        limit?: number;
    }): Promise<ProductionPracticeRecord[]> {
        const { videoId, fileHash, limit = 10 } = location;
        if (!videoId && !fileHash) {
            return [];
        }
        const locator = [
            videoId ? eq(productionPracticeRecord.video_id, videoId) : undefined,
            fileHash ? eq(productionPracticeRecord.file_hash, fileHash) : undefined,
        ].filter((condition) => condition !== undefined);
        return this.db
            .select()
            .from(productionPracticeRecord)
            .where(locator.length === 1 ? locator[0] : or(...locator))
            .orderBy(desc(productionPracticeRecord.id))
            .limit(Math.max(1, Math.min(50, limit)));
    }
}
