import { create } from 'zustand';

/**
 * 复习坞的跨页面打开请求。
 *
 * 首页推荐只负责发出“打开复习”的意图；真正的复习坞仍在播放器学习台里，
 * 避免在首页复制一套复习 UI。
 */
interface ReviewDockStore {
    /** 请求打开的次数；每次 open 递增，播放器用已消费计数判断是否有新请求。 */
    requestId: number;
    /** 已消费到的请求次数。 */
    consumedId: number;
    /** 请求打开一次；播放器消费后应立即调用 `consume`。 */
    open: () => void;
    /** 播放器处理完请求后标记已消费。 */
    consume: (requestId: number) => void;
}

export const useReviewDockStore = create<ReviewDockStore>((set) => ({
    requestId: 0,
    consumedId: 0,
    open: () => set((state) => ({ requestId: state.requestId + 1 })),
    consume: (requestId) => set((state) => ({
        consumedId: Math.max(state.consumedId, requestId),
    })),
}));
