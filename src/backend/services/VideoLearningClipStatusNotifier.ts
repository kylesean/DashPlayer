import type RendererGateway from '@/backend/services/gateways/renderer/RendererGateway';
import type { VideoLearningClipStatusVO } from '@/common/types/vo/VideoLearningClipStatusVO';

/**
 * 各字幕可处于的片段状态。
 */
type ClipStatus = 'pending' | 'in_progress' | 'completed' | 'analyzing';

/**
 * 片段状态通知器：缓存各字幕最近一次裁切状态，状态变化时推送给渲染进程。
 *
 * 从 VideoLearningService 拆出的用意：状态缓存、序号递增与去重通知是一块
 * 自洽的发布逻辑，服务本体只剩编排；缓存清理（invalidate/clear）也随状态
 * 的归属收敛到这里，避免「谁都能顺手改缓存」的散落写点。
 */
export default class VideoLearningClipStatusNotifier {
    /** 各字幕最近一次片段状态。 */
    private readonly statusCache: Map<string, VideoLearningClipStatusVO> = new Map();
    /** 各字幕状态通知的递增序号。 */
    private readonly seqBySrtKey: Map<string, number> = new Map();
    /** 串行化状态推送 IPC，保证渲染进程严格按递增 seq 顺序收包。 */
    private sendQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly deps: {
            /** 渲染进程 API 网关。 */
            rendererGateway: RendererGateway;
            /** 日志出口。 */
            logger: { debug: (message: string, data?: unknown) => void; error: (message: string, data?: unknown) => void };
        }
    ) {}

    /**
     * 缓存并通知字幕的最新裁切状态。
     *
     * 状态内容没有变化时只保留缓存，不重复通知渲染进程。
     *
     * @param videoPath 视频路径。
     * @param srtKey 字幕缓存键。
     * @param status 当前状态。
     * @param pendingCount 待裁切数量。
     * @param inProgressCount 正在裁切数量。
     * @param completedCount 已完成数量。
     * @param analyzingProgress 分析进度百分比。
     */
    public async notify(
        videoPath: string,
        srtKey: string,
        status: ClipStatus,
        pendingCount?: number,
        inProgressCount?: number,
        completedCount?: number,
        analyzingProgress?: number
    ): Promise<void> {
        try {
            this.deps.logger.debug('clip status notify', {
                videoPath,
                srtKey,
                status,
                pendingCount: pendingCount ?? null,
                inProgressCount: inProgressCount ?? null,
                completedCount: completedCount ?? null,
                analyzingProgress: analyzingProgress ?? null,
            });

            let message = '';
            if (status === 'pending') {
                message = `发现 ${pendingCount ?? 0} 个需要裁切的学习片段`;
            } else if (status === 'in_progress') {
                message = `正在裁切 ${inProgressCount ?? 0} 个学习片段`;
            } else if (status === 'analyzing') {
                message = `正在分析视频内容 (${analyzingProgress ?? 0}%)`;
            } else {
                message = '所有学习片段已裁切完成';
            }

            const cachePayload: VideoLearningClipStatusVO = {
                status,
            };

            if (typeof pendingCount === 'number') {
                cachePayload.pendingCount = pendingCount;
            }
            if (typeof inProgressCount === 'number') {
                cachePayload.inProgressCount = inProgressCount;
            }
            if (typeof completedCount === 'number') {
                cachePayload.completedCount = completedCount;
            }
            if (typeof analyzingProgress === 'number') {
                cachePayload.analyzingProgress = analyzingProgress;
            }

            const prev = this.statusCache.get(srtKey);
            const sameStatus =
                prev?.status === cachePayload.status &&
                prev?.pendingCount === cachePayload.pendingCount &&
                prev?.inProgressCount === cachePayload.inProgressCount &&
                prev?.completedCount === cachePayload.completedCount &&
                prev?.analyzingProgress === cachePayload.analyzingProgress;

            const nextSeq = sameStatus ? (prev?.seq ?? 0) : (this.seqBySrtKey.get(srtKey) ?? prev?.seq ?? 0) + 1;
            this.seqBySrtKey.set(srtKey, nextSeq);
            cachePayload.seq = nextSeq;
            this.statusCache.set(srtKey, cachePayload);

            if (!sameStatus) {
                const payload = {
                    videoPath,
                    srtKey,
                    status,
                    pendingCount,
                    inProgressCount,
                    completedCount,
                    message,
                    analyzingProgress,
                    seq: nextSeq,
                };
                const dispatched = this.sendQueue.then(async () => {
                    await this.deps.rendererGateway.call('video-learning/clip-status-update', payload);
                });
                this.sendQueue = dispatched.catch(() => undefined);
                await dispatched;
            }
        } catch (error) {
            this.deps.logger.error('failed to notify clip status', { error });
        }
    }

    /**
     * 丢弃指定字幕的缓存状态；下一次检测会重新计算并通知。
     *
     * @param srtKey 字幕缓存键。
     */
    public invalidate(srtKey: string): void {
        this.statusCache.delete(srtKey);
    }

    /**
     * 清空全部字幕的状态缓存。
     */
    public clear(): void {
        this.statusCache.clear();
    }

    /**
     * 读取指定字幕的缓存状态。
     *
     * @param srtKey 字幕缓存键。
     * @returns 缓存的状态；没有时返回 undefined。
     */
    public getCached(srtKey: string): VideoLearningClipStatusVO | undefined {
        return this.statusCache.get(srtKey);
    }

    /**
     * 读取指定字幕的当前通知序号。
     *
     * @param srtKey 字幕缓存键。
     * @returns 当前序号；从未通知过时返回 undefined。
     */
    public peekSeq(srtKey: string): number | undefined {
        return this.seqBySrtKey.get(srtKey);
    }

    /**
     * 为没有序列号的状态补充当前序号；不递增、不触发通知。
     *
     * @param srtKey 字幕缓存键。
     * @param status 当前状态。
     * @returns 带有序列号的状态。
     */
    public ensureSeq(srtKey: string, status: VideoLearningClipStatusVO): VideoLearningClipStatusVO {
        if (status.seq !== undefined) {
            return status;
        }
        const nextSeq = this.seqBySrtKey.get(srtKey) ?? 1;
        this.seqBySrtKey.set(srtKey, nextSeq);
        return { ...status, seq: nextSeq };
    }
}
