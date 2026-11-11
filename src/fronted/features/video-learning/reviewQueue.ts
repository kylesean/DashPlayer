import { mutate } from 'swr';

/**
 * 复习队列在 SWR 中的全局键。
 *
 * 工具条徽标、播放器复习坞与练习写入共用同一份缓存；练习完成后主动失效，
 * 用户不需要等轮询才知道新词已经进入到期队列。
 */
export const REVIEW_QUEUE_SWR_KEY = 'vocabulary/review-queue';

/**
 * 使复习队列缓存失效并重新拉取。
 */
export const revalidateReviewQueue = (): void => {
    void mutate(REVIEW_QUEUE_SWR_KEY);
};
