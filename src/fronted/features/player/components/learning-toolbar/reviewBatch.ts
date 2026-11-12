/**
 * 复习坞的分组口径。
 *
 * 计划要求「到期词以 3–5 个为一组」：一组是注意力的单位，不是服务端的分页单位。
 * 用户看到「第 2 / 5 张」就知道还有多远，比一个无限长的到期队列更容易坚持。
 *
 * 这里刻意不缓存打开时的队列快照：每评完一张，服务端会重新排期并把该词移出
 * 到期列表。用「已复习词」与「当前队列」两个实时输入推导进度，得到的组大小
 * 在正常流程里是稳定的，而快照会在词被改期后留下一条永远不会消失的幽灵卡。
 */

/** 一组的默认大小；落在计划要求的 3–5 区间上沿。 */
export const REVIEW_BATCH_SIZE = 5;

/** 一组的进度视图。 */
export interface ReviewBatchView<T> {
    /** 当前该复习的卡；本组已完成时为 null。 */
    card: T | null;
    /** 本组已完成的张数。 */
    done: number;
    /** 本组总张数。 */
    total: number;
    /** 本组是否已经做完。 */
    isComplete: boolean;
}

/**
 * 推导当前这一组的进度。
 *
 * `total` 取 `min(批次大小, 已完成 + 仍待复习)`：到期词不足一批时不该显示
 * 「第 1 / 5 张」这种永远做不满的进度；评完一张后服务端把它移出列表，
 * 已完成 +1、待复习 -1，总数保持稳定。
 *
 * @param items 当前到期队列。
 * @param reviewedWords 本组已复习的词（不区分大小写）。
 * @param batchSize 组大小。
 * @returns 当前卡与进度。
 */
export function selectReviewBatch<T extends { word: string }>(
    items: readonly T[],
    reviewedWords: readonly string[],
    batchSize: number = REVIEW_BATCH_SIZE,
): ReviewBatchView<T> {
    const reviewed = new Set(reviewedWords.map((word) => word.toLowerCase()));
    const pending = items.filter((item) => !reviewed.has(item.word.toLowerCase()));
    const done = reviewedWords.length;
    const available = done + pending.length;
    // 空队列不是「这一组做完了」，而是「没有东西可做」：两者在界面上是不同的文案，
    // 前者该给「继续下一组」，后者该给「下次复习时间」。
    if (available === 0) {
        return { card: null, done: 0, total: 0, isComplete: false };
    }
    const total = Math.min(Math.max(1, Math.trunc(batchSize)), available);
    const isComplete = done >= total;
    return {
        card: isComplete ? null : pending[0] ?? null,
        done: Math.min(done, total),
        total,
        isComplete,
    };
}
