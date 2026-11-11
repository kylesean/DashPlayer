import type { SceneIndexRow } from '@/backend/infrastructure/db/tables/sceneIndex';

/**
 * 场景切分索引仓储。
 *
 * 只缓存确定性的本地切分结果，不参与任何模型调用；读写失败都只意味着
 * 「下次重新计算」，不能阻断播放。
 */
export default interface SceneIndexRepository {
    /**
     * 读取某个字幕文件在指定算法版本下的索引。
     *
     * @param fileHash 字幕内容哈希。
     * @param algorithmVersion 切分算法版本。
     * @returns 命中的行；不存在时为 null。
     */
    find(fileHash: string, algorithmVersion: number): Promise<SceneIndexRow | null>;

    /**
     * 写入或更新一条索引（按 file_hash + algorithm_version 唯一键）。
     */
    upsert(value: {
        fileHash: string;
        algorithmVersion: number;
        inputHash: string;
        boundariesJson: string;
    }): Promise<void>;

    /**
     * 删除某个字幕文件的全部版本。
     *
     * 字幕文件被删除时调用；算法版本升级则不必删，旧行会因唯一键不再命中
     * 而被覆盖或闲置。
     */
    deleteByFile(fileHash: string): Promise<number>;
}
