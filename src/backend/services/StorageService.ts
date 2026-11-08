import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type { StorageStatusVO } from '@/common/types/vo/StorageStatusVO';
import type { StorageUsageItemVO, StorageUsageVO } from '@/common/contracts/storage-usage-vo';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import {
    StorageDirectoryTarget,
    resolveStorageDirectory,
} from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';

/**
 * 媒体库存储业务服务。
 */
export default interface StorageService {
    /**
     * 查询媒体库存储用量明细。
     *
     * 行为说明：
     * - 仅在媒体库可访问时才执行目录遍历，目录失效时抛出显式错误；
     * - 固定子目录尚未创建时按 0 统计，不视为异常；
     * - 未纳入固定分类的文件统一归入 `other` 分类。
     *
     * @returns 媒体库总大小及各分类大小明细。
     */
    queryStorageUsage(): Promise<StorageUsageVO>;

    /**
     * 查询当前媒体库根目录的健康与访问状态。
     *
     * @returns 可供前端展示的目录健康状态。
     */
    queryStorageStatus(): Promise<StorageStatusVO>;

    /**
     * 列出当前可用的收藏集合路径列表。
     *
     * @returns 当前支持的收藏集合名称列表。
     */
    listCollectionPaths(): Promise<string[]>;
}

/**
 * 媒体库存储业务服务实现。
 */
@injectable()
export class StorageServiceImpl implements StorageService {
    /**
     * 构造媒体库存储业务服务。
     *
     * @param settingsStore 设置存储端口。
     * @param storageDirectoryProvider 外部存储目录提供器。
     * @param fileSystemGateway 文件系统访问端口。
     */
    constructor(
        @inject(TYPES.SettingsStore) private readonly settingsStore: SettingsStore,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    /**
     * 查询媒体库存储用量明细。
     *
     * @returns 按占用降序排列的非零分类明细及总占用字节数。
     */
    public async queryStorageUsage(): Promise<StorageUsageVO> {
        const libraryRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.LIBRARY_ROOT);
        const totalBytes = await this.fileSystemGateway.getDirectorySize(libraryRoot);

        const videosBytes = await this.queryDirectoryUsage(libraryRoot, StorageDirectoryTarget.VIDEOS);
        const favouriteClipsBytes = await this.queryDirectoryUsage(libraryRoot, StorageDirectoryTarget.FAVORITE_CLIPS);
        const wordClipsBytes = await this.queryDirectoryUsage(libraryRoot, StorageDirectoryTarget.WORD_VIDEO);
        const tempBytes = (await this.queryDirectoryUsage(libraryRoot, StorageDirectoryTarget.TEMP))
            + (await this.queryDirectoryUsage(libraryRoot, StorageDirectoryTarget.TEMP_OSS));
        // 语音模型与本地 AI 模型都存放在 models 目录下（按子目录区分），统一计入「模型」分类。
        const modelsBytes = await this.queryDirectoryUsage(libraryRoot, StorageDirectoryTarget.MODELS);

        // word_video 位于 favorite_clips 内，收藏片段分类只保留其余部分；
        // 目录内容在两次遍历之间可能变化，差值为负时按 0 展示。
        const favouriteClipsOnlyBytes = Math.max(favouriteClipsBytes - wordClipsBytes, 0);
        const otherBytes = Math.max(
            totalBytes - videosBytes - favouriteClipsOnlyBytes - wordClipsBytes - tempBytes - modelsBytes,
            0,
        );

        const knownItems: StorageUsageItemVO[] = [
            { category: 'videos', bytes: videosBytes },
            { category: 'favorite_clips', bytes: favouriteClipsOnlyBytes },
            { category: 'word_clips', bytes: wordClipsBytes },
            { category: 'models', bytes: modelsBytes },
            { category: 'temp', bytes: tempBytes },
            { category: 'other', bytes: otherBytes },
        ];
        const items = knownItems
            .filter((item) => item.bytes > 0)
            .sort((a, b) => b.bytes - a.bytes);

        return { totalBytes, items };
    }

    /**
     * 统计指定目标目录的占用大小；目录尚未创建时返回 0。
     *
     * @param libraryRoot 已确认可访问的媒体库根目录。
     * @param target 目录目标。
     * @returns 目录占用大小，单位字节。
     */
    private async queryDirectoryUsage(libraryRoot: string, target: StorageDirectoryTarget): Promise<number> {
        return this.fileSystemGateway.getDirectorySizeIfExists(resolveStorageDirectory(libraryRoot, target));
    }

    /**
     * 查询当前媒体库根目录的健康与访问状态。
     *
     * @returns 媒体库根目录访问状态。
     */
    public async queryStorageStatus(): Promise<StorageStatusVO> {
        return await this.storageDirectoryProvider.getRootStatus(this.settingsStore.get('storage.path'));
    }

    /**
     * 列出当前可用的收藏集合路径列表。
     *
     * @returns 集合名称数组。
     */
    public async listCollectionPaths(): Promise<string[]> {
        return ['default'];
    }
}
