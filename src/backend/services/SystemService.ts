import path from 'path';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { UPDATE_TOAST_LAST_SHOWN_AT_KEY } from '@/common/constants/systemConfigKeys';
import type { UpdateCheckResult } from '@/common/types/update-check';
import { checkUpdate } from '@/backend/services/CheckUpdate';
import type SystemConfigService from '@/backend/services/SystemConfigService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type DatabaseMaintenance from '@/backend/services/gateways/db/DatabaseMaintenance';

/**
 * 系统维护与杂项应用服务。
 *
 * 承担数据库重置、更新检查冷却策略、目录打开前置准备及系统配置读写。
 */
export default interface SystemService {
    /**
     * 清空运行环境数据库。
     */
    resetDatabase(): Promise<void>;

    /**
     * 准备待打开的文件夹路径，必要时创建缺失目录。
     *
     * 行为说明：
     * - 传入路径本身为目录时直接返回该目录；
     * - 传入文件或尚不存在的路径时解析其父目录；
     * - 仅当 `createDirectory === true` 时才确保目标目录存在。
     *
     * @param request 路径与可选的自动创建开关。
     * @returns 最终应由系统文件管理器打开的目录路径。
     */
    prepareFolderForOpen(request: { path: string; createDirectory?: boolean }): Promise<string>;

    /**
     * 解析并确保媒体库根目录可访问。
     *
     * @returns 可访问的媒体库根目录路径。
     */
    resolveCacheDirectory(): Promise<string>;

    /**
     * 检查应用更新，并在弹窗模式下执行提醒冷却控制。
     *
     * @param currentVersion 当前应用版本号。
     * @param params 检查参数；`mode === 'toast'` 时附加 `shouldNotify` 标记。
     * @returns 更新检查结果。
     */
    checkUpdate(currentVersion: string, params?: { mode?: 'toast' }): Promise<UpdateCheckResult>;

    /**
     * 读取指定系统配置。
     *
     * @param key 配置键。
     * @returns 配置值；不存在时返回 `null`。
     */
    getSystemConfig(key: string): Promise<string | null>;

    /**
     * 保存指定系统配置。
     *
     * @param key 配置键。
     * @param value 配置值。
     */
    setSystemConfig(key: string, value: string): Promise<void>;
}

/**
 * 系统维护与杂项应用服务实现。
 */
@injectable()
export class SystemServiceImpl implements SystemService {
    /** 启动弹窗式更新提醒的最短间隔（毫秒）。 */
    private static readonly UPDATE_TOAST_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

    /**
     * 构造系统服务实例。
     *
     * @param systemConfigService 系统配置读写服务。
     * @param storageDirectoryProvider 外部存储目录提供器。
     * @param fileSystemGateway 文件系统访问端口。
     * @param databaseMaintenance 数据库维护端口。
     */
    constructor(
        @inject(TYPES.SystemConfigService) private readonly systemConfigService: SystemConfigService,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
        @inject(TYPES.DatabaseMaintenance) private readonly databaseMaintenance: DatabaseMaintenance,
    ) {}

    /**
     * 清空运行环境数据库。
     */
    public async resetDatabase(): Promise<void> {
        await this.databaseMaintenance.clearAll();
    }

    /**
     * 准备待打开的文件夹路径，仅在显式允许时创建不存在的目录。
     *
     * @param request 路径与可选的自动创建开关。
     * @returns 待打开的目录绝对路径。
     */
    public async prepareFolderForOpen(request: { path: string; createDirectory?: boolean }): Promise<string> {
        const targetIsDirectory = await this.fileSystemGateway.directoryExists(request.path);
        const folder = targetIsDirectory ? request.path : path.dirname(request.path);
        if (request.createDirectory === true) {
            await this.fileSystemGateway.ensureDirectory(folder);
        }
        return folder;
    }

    /**
     * 解析并确保媒体库根目录可访问。
     *
     * @returns 媒体库根目录绝对路径。
     */
    public async resolveCacheDirectory(): Promise<string> {
        return await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.LIBRARY_ROOT);
    }

    /**
     * 检查应用更新，并在 `toast` 模式下控制每日一次提醒节流。
     *
     * @param currentVersion 当前应用版本号。
     * @param params 检查模式参数。
     * @returns 更新检查结果；弹窗模式且存在可用更新时附带 `shouldNotify`。
     */
    public async checkUpdate(currentVersion: string, params?: { mode?: 'toast' }): Promise<UpdateCheckResult> {
        const result = await checkUpdate(currentVersion);
        if (params?.mode !== 'toast' || result.status !== 'ok' || result.releases.length === 0) {
            return result;
        }

        const now = Date.now();
        const lastShownRaw = await this.systemConfigService.getValue(UPDATE_TOAST_LAST_SHOWN_AT_KEY);
        const lastShownAt = lastShownRaw ? Number(lastShownRaw) : 0;
        const shouldNotify =
            Number.isNaN(lastShownAt) || now - lastShownAt >= SystemServiceImpl.UPDATE_TOAST_MIN_INTERVAL_MS;

        if (shouldNotify) {
            await this.systemConfigService.setValue(UPDATE_TOAST_LAST_SHOWN_AT_KEY, String(now));
        }

        return {
            ...result,
            shouldNotify,
        };
    }

    /**
     * 读取指定系统配置。
     *
     * @param key 配置键。
     * @returns 配置值；不存在时返回 `null`。
     */
    public async getSystemConfig(key: string): Promise<string | null> {
        return this.systemConfigService.getValue(key);
    }

    /**
     * 保存指定系统配置。
     *
     * @param key 配置键。
     * @param value 配置值。
     */
    public async setSystemConfig(key: string, value: string): Promise<void> {
        await this.systemConfigService.setValue(key, value);
    }
}
