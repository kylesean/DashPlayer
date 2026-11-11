import type {
    InsertProductionPracticeRecord,
    ProductionPracticeRecord,
} from '@/backend/infrastructure/db/tables/productionPracticeRecord';

/**
 * 产出型练习（复述 / 角色扮演）记录仓储接口。
 */
export default interface ProductionPracticeRecordRepository {
    /**
     * 写入一条练习记录。
     *
     * @returns 新记录的自增 id。
     */
    insertOne(value: InsertProductionPracticeRecord): Promise<number>;
    /**
     * 查询某个视频下最近的练习记录，按创建时间倒序。
     *
     * 只用于复盘弹窗展示「上次结果」，不参与推荐或掌握度计算。
     */
    listRecentByLocation(location: {
        videoId?: string;
        fileHash?: string;
        limit?: number;
    }): Promise<ProductionPracticeRecord[]>;
}
