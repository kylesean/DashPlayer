import type { TopicVectorRow } from '@/backend/infrastructure/db/tables/topicVector';

/**
 * 一条待写入的主题向量。
 */
export interface TopicVectorWrite {
    videoId: string;
    model: string;
    dimension: number;
    /** Float32 小端字节。 */
    vector: Buffer;
    /** 生成向量所用主题文本的哈希。 */
    textHash: string;
}

/**
 * 主题向量索引仓储。
 *
 * 只负责存取，不做相似度计算：检索仍在内存里完成，样本量是最近若干视频，
 * 线性扫描足够；落库解决的是「重启后不必重新推理」与「增量更新」。
 */
export default interface TopicVectorRepository {
    /**
     * 读取指定模型下的全部向量。
     *
     * @param model 模型标识；不同模型的向量空间不可比较。
     */
    listByModel(model: string): Promise<TopicVectorRow[]>;

    /**
     * 按视频批量读取指定模型的向量。
     *
     * @param model 模型标识。
     * @param videoIds 视频路径列表。
     */
    listByVideoIds(model: string, videoIds: readonly string[]): Promise<TopicVectorRow[]>;

    /**
     * 写入或更新一条向量（按 video_id + model 唯一键）。
     */
    upsert(value: TopicVectorWrite): Promise<void>;

    /**
     * 批量写入或更新。
     *
     * 在一个事务里完成，避免中断后出现一半新、一半旧的索引。
     */
    upsertMany(values: readonly TopicVectorWrite[]): Promise<void>;

    /**
     * 删除某个模型的全部向量。
     *
     * 模型切换或维度变化时使用：旧空间的向量不能与新查询混算。
     */
    deleteByModel(model: string): Promise<number>;

    /**
     * 删除指定视频在所有模型下的向量。
     *
     * 观看记录被删除或视频文件失效时调用。
     */
    deleteByVideoIds(videoIds: readonly string[]): Promise<number>;
}
