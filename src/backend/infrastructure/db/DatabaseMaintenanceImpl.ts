import { injectable } from 'inversify';
import { clearDB } from '@/backend/infrastructure/db/db';
import type DatabaseMaintenance from '@/backend/services/gateways/db/DatabaseMaintenance';

/**
 * 数据库维护端口实现。
 */
@injectable()
export default class DatabaseMaintenanceImpl implements DatabaseMaintenance {
    /**
     * 清空当前运行环境数据库中的所有业务表、索引和自增序列。
     */
    public async clearAll(): Promise<void> {
        await clearDB();
    }
}
