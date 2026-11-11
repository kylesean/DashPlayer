import type { MediaSignalRow } from '@/backend/infrastructure/db/tables/mediaSignal';

/**
 * 视频级派生信号仓储。
 *
 * 只负责存取，不判断信号是否仍然有效：版本与输入指纹的比对由业务层完成，
 * 仓储不做隐式回退。
 */
export default interface MediaSignalRepository {
    /**
     * 读取某个视频在指定类型与版本下的信号。
     *
     * @param videoId 视频路径。
     * @param kind 信号类型。
     * @param algorithmVersion 算法版本。
     * @returns 命中的行；不存在时为 null。
     */
    find(videoId: string, kind: string, algorithmVersion: number): Promise<MediaSignalRow | null>;

    /**
     * 写入或更新一条信号（按 video_id + kind + algorithm_version 唯一键）。
     */
    upsert(value: {
        videoId: string;
        kind: string;
        algorithmVersion: number;
        inputHash: string;
        payloadJson: string;
    }): Promise<void>;

    /**
     * 删除某个视频的全部信号。
     *
     * 视频被移除时调用，避免索引里留下永远命中不了的条目。
     *
     * @param videoId 视频路径。
     * @returns 删除的行数。
     */
    deleteByVideo(videoId: string): Promise<number>;

    /**
     * 剔除不在给定集合内的信号。
     *
     * 观看记录被删除或视频被移走后，索引里会留下死条目；按「当前仍存在的
     * 视频集合」自愈，删除路径漏掉也不会让表无限增长。
     *
     * @param activeVideoIds 当前仍存在的视频路径。
     * @returns 删除的行数。
     */
    pruneExcept(activeVideoIds: readonly string[]): Promise<number>;
}
