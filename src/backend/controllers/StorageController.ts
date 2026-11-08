import registerRoute from '@/backend/controllers/ipc/registerRoute';
import type Controller from '@/backend/controllers/Controller';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type { StorageStatusVO } from '@/common/types/vo/StorageStatusVO';
import type { StorageUsageVO } from '@/common/contracts/storage-usage-vo';
import type StorageService from '@/backend/services/StorageService';

/**
 * 媒体库存储 IPC 控制器。
 */
@injectable()
export default class StorageController implements Controller {
    /**
     * 构造存储控制器。
     *
     * @param storageService 媒体库存储业务服务。
     */
    constructor(
        @inject(TYPES.StorageService) private readonly storageService: StorageService,
    ) {}

    /**
     * 查询媒体库存储用量明细。
     *
     * @returns 媒体库总大小及分类明细。
     */
    public async queryStorageUsage(): Promise<StorageUsageVO> {
        return this.storageService.queryStorageUsage();
    }

    /**
     * 返回当前媒体库目录健康状态。
     *
     * @returns 可供设置页直接展示的状态信息。
     */
    public async queryStorageStatus(): Promise<StorageStatusVO> {
        return this.storageService.queryStorageStatus();
    }

    /**
     * 列出可切换的收藏集合。
     *
     * @returns 当前支持的集合列表。
     */
    public async listCollectionPaths(): Promise<string[]> {
        return this.storageService.listCollectionPaths();
    }

    /**
     * 注册存储相关 IPC 路由。
     */
    registerRoutes(): void {
        registerRoute('storage/usage', () => this.queryStorageUsage());
        registerRoute('storage/status', () => this.queryStorageStatus());
        registerRoute('storage/collection/paths', () => this.listCollectionPaths());
    }
}
