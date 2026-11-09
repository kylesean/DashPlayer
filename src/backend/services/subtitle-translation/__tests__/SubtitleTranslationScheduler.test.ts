import { describe, expect, it, vi } from 'vitest';
import SubtitleTranslationScheduler, {
    MAX_REQUEUE_COUNT,
    type SubtitleTranslationBatchRequest,
    type SubtitleTranslationBatchResult,
    type SubtitleTranslationDemand,
} from '../SubtitleTranslationScheduler';

/** 测试用翻译配置上下文；调度器对上下文形状无要求。 */
interface TestContext {
    tag: string;
}

/** 可手工控制完成时机的批次执行器返回值。 */
interface DeferredBatch {
    promise: Promise<SubtitleTranslationBatchResult>;
    resolve: (result: SubtitleTranslationBatchResult) => void;
    reject: (error: unknown) => void;
}

/** 组装一个标准需求：10 句字幕按 5 句一批，共两个批次。 */
const buildDemand = (overrides: Partial<SubtitleTranslationDemand<TestContext>> = {}): SubtitleTranslationDemand<TestContext> => ({
    fileHash: 'file-a',
    currentIndex: 0,
    demandId: 1,
    rendererSessionId: 'renderer-1',
    sentenceIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    profileKey: 'local#model#zh#sig',
    context: { tag: 'local' },
    ...overrides,
});

const createDeferred = (): DeferredBatch => {
    let resolve!: (result: SubtitleTranslationBatchResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<SubtitleTranslationBatchResult>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

/** 排空调度器内部的 Promise 链，让批次完成路径执行完毕。 */
const flushAsync = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

describe('字幕翻译调度器', () => {
    it('释放会话后在途批次继续执行完成：取消信号不触发，结果照常返回且不再重试', async () => {
        const inFlight: Array<{ request: SubtitleTranslationBatchRequest<TestContext>; deferred: DeferredBatch }> = [];
        const onBatchRequeued = vi.fn();
        const onBatchDeadLetter = vi.fn();
        const onBatchDropped = vi.fn();
        const scheduler = new SubtitleTranslationScheduler<TestContext>({
            executeBatch: (request) => {
                const deferred = createDeferred();
                inFlight.push({ request, deferred });
                return deferred.promise;
            },
            onBatchRequeued,
            onBatchDeadLetter,
            onBatchDropped,
        });

        scheduler.updateDemand(buildDemand());
        expect(inFlight).toHaveLength(2);

        scheduler.release('file-a', 'renderer-1');
        expect(inFlight[0].request.signal.aborted).toBe(false);
        expect(inFlight[1].request.signal.aborted).toBe(false);

        inFlight[0].deferred.resolve({ completedIndices: [0, 1, 2, 3, 4], failedIndices: [], cancelled: false });
        // 第二批全部失败：若是附着会话会重新入队，释放后必须静默结束。
        inFlight[1].deferred.resolve({ completedIndices: [], failedIndices: [5, 6, 7, 8, 9], cancelled: false });
        await flushAsync();

        expect(inFlight).toHaveLength(2);
        expect(onBatchRequeued).not.toHaveBeenCalled();
        expect(onBatchDeadLetter).not.toHaveBeenCalled();
        expect(onBatchDropped).not.toHaveBeenCalled();
    });

    it('释放会话后批次执行异常：异常照常上报，但不进入死信也不再执行', async () => {
        const inFlight: Array<{ request: SubtitleTranslationBatchRequest<TestContext>; deferred: DeferredBatch }> = [];
        const onBatchError = vi.fn();
        const onBatchDeadLetter = vi.fn();
        const scheduler = new SubtitleTranslationScheduler<TestContext>({
            executeBatch: (request) => {
                const deferred = createDeferred();
                inFlight.push({ request, deferred });
                return deferred.promise;
            },
            onBatchError,
            onBatchDeadLetter,
        });

        scheduler.updateDemand(buildDemand());
        scheduler.release('file-a', 'renderer-1');

        const boom = new Error('推理进程退出');
        inFlight[0].deferred.reject(boom);
        inFlight[1].deferred.resolve({ completedIndices: [5, 6, 7, 8, 9], failedIndices: [], cancelled: false });
        await flushAsync();

        expect(onBatchError).toHaveBeenCalledTimes(1);
        expect(onBatchError.mock.calls[0][0]).toBe(boom);
        expect(onBatchDeadLetter).not.toHaveBeenCalled();
        expect(inFlight).toHaveLength(2);
    });

    it('切换 renderer 会话后：旧会话在途批次不被中止，新会话批次照常调度', async () => {
        const inFlight: Array<{ request: SubtitleTranslationBatchRequest<TestContext>; deferred: DeferredBatch }> = [];
        const onBatchDeadLetter = vi.fn();
        const scheduler = new SubtitleTranslationScheduler<TestContext>({
            executeBatch: (request) => {
                const deferred = createDeferred();
                inFlight.push({ request, deferred });
                return deferred.promise;
            },
            onBatchDeadLetter,
        });

        scheduler.updateDemand(buildDemand({ demandId: 1, rendererSessionId: 'renderer-1' }));
        expect(inFlight).toHaveLength(2);

        scheduler.updateDemand(buildDemand({ demandId: 2, rendererSessionId: 'renderer-2' }));
        // 新会话立即调度自己的窗口批次；旧批次仍留在途。
        expect(inFlight).toHaveLength(4);
        expect(inFlight.slice(0, 2).map((batch) => batch.request.demandId)).toEqual([1, 1]);
        expect(inFlight.slice(2).map((batch) => batch.request.demandId)).toEqual([2, 2]);
        expect(inFlight[0].request.signal.aborted).toBe(false);

        for (const batch of inFlight) {
            batch.deferred.resolve({
                completedIndices: batch.request.indices,
                failedIndices: [],
                cancelled: false,
            });
        }
        await flushAsync();
        expect(onBatchDeadLetter).not.toHaveBeenCalled();
    });

    it('附着会话的批次失败后按现有规则重新入队并再次执行', async () => {
        const inFlight: Array<{ request: SubtitleTranslationBatchRequest<TestContext>; deferred: DeferredBatch }> = [];
        const scheduler = new SubtitleTranslationScheduler<TestContext>({
            executeBatch: (request) => {
                const deferred = createDeferred();
                inFlight.push({ request, deferred });
                return deferred.promise;
            },
        });

        scheduler.updateDemand(buildDemand());
        inFlight[0].deferred.resolve({ completedIndices: [0, 1, 2, 3, 4], failedIndices: [], cancelled: false });
        await flushAsync();
        inFlight[1].deferred.resolve({ completedIndices: [], failedIndices: [5, 6, 7, 8, 9], cancelled: false });
        await flushAsync();

        // 失败批次重新入队并立即重新执行，携带递增的重试计数。
        expect(inFlight).toHaveLength(3);
        expect(inFlight[2].request.requeueCount).toBe(1);
        expect(inFlight[2].request.indices).toEqual([5, 6, 7, 8, 9]);
        expect(inFlight[2].request.signal.aborted).toBe(false);

        inFlight[2].deferred.resolve({ completedIndices: [5, 6, 7, 8, 9], failedIndices: [], cancelled: false });
        await flushAsync();
        expect(inFlight).toHaveLength(3);
    });

    it('持续失败的批次在达到重试上限后进入死信，不再无限重试', async () => {
        // 上限本身必须是一个有限的小值：若被改成极大数（等价于无限重试），
        // 下面的循环会以同一常量自洽通过，因此这里单独钉住量级。
        expect(MAX_REQUEUE_COUNT).toBeGreaterThan(0);
        expect(MAX_REQUEUE_COUNT).toBeLessThanOrEqual(5);

        const inFlight: Array<{ request: SubtitleTranslationBatchRequest<TestContext>; deferred: DeferredBatch }> = [];
        const onBatchRequeued = vi.fn();
        const onBatchDeadLetter = vi.fn();
        const scheduler = new SubtitleTranslationScheduler<TestContext>({
            executeBatch: (request) => {
                const deferred = createDeferred();
                inFlight.push({ request, deferred });
                return deferred.promise;
            },
            onBatchRequeued,
            onBatchDeadLetter,
        });

        scheduler.updateDemand(buildDemand());

        // 第一批正常完成，把窗口推进到第二个批次。
        inFlight[0].deferred.resolve({ completedIndices: [0, 1, 2, 3, 4], failedIndices: [], cancelled: false });
        await flushAsync();

        // 第二个批次持续失败：每次都把整批标为 failed，直到触发死信。
        for (let attempt = 0; attempt <= MAX_REQUEUE_COUNT; attempt += 1) {
            const current = inFlight[inFlight.length - 1];
            expect(current).toBeDefined();
            current.deferred.resolve({
                completedIndices: [],
                failedIndices: current.request.indices,
                cancelled: false,
            });
            await flushAsync();
        }

        // 重试次数用尽后不再产生新批次，且只上报一次死信。
        expect(onBatchRequeued).toHaveBeenCalledTimes(MAX_REQUEUE_COUNT);
        expect(onBatchDeadLetter).toHaveBeenCalledTimes(1);
        const deadLetter = onBatchDeadLetter.mock.calls[0][0];
        expect(deadLetter.indices).toEqual([5, 6, 7, 8, 9]);
        expect(deadLetter.requeueCount).toBe(MAX_REQUEUE_COUNT);

        // 死信之后该批次不会再被执行。
        const countAfterDeadLetter = inFlight.length;
        await flushAsync();
        expect(inFlight).toHaveLength(countAfterDeadLetter);
    });

    it('同一会话内字幕坐标变多时，已建批次区间内的新坐标仍会被翻译', async () => {
        const inFlight: Array<{ request: SubtitleTranslationBatchRequest<TestContext>; deferred: DeferredBatch }> = [];
        const scheduler = new SubtitleTranslationScheduler<TestContext>({
            executeBatch: (request) => {
                const deferred = createDeferred();
                inFlight.push({ request, deferred });
                return deferred.promise;
            },
        });

        // 首次需求只有 3 句：批次 0 建好并完成。
        scheduler.updateDemand(buildDemand({
            sentenceIndices: [0, 1, 2],
        }));
        expect(inFlight).toHaveLength(1);
        expect(inFlight[0].request.indices).toEqual([0, 1, 2]);
        inFlight[0].deferred.resolve({ completedIndices: [0, 1, 2], failedIndices: [], cancelled: false });
        await flushAsync();

        // 同一会话内坐标扩到 5 句：批次 0 里多出 3、4，必须补建批次。
        // 若按「批次起点已登记」直接跳过，这两句会永久没有译文。
        scheduler.updateDemand(buildDemand({
            demandId: 2,
            sentenceIndices: [0, 1, 2, 3, 4],
        }));
        expect(inFlight).toHaveLength(2);
        expect(inFlight[1].request.indices).toEqual([3, 4]);

        // 已完成的 0..2 不能因为重建批次而被重复翻译。
        expect(inFlight[1].request.indices).not.toContain(0);
        inFlight[1].deferred.resolve({ completedIndices: [3, 4], failedIndices: [], cancelled: false });
        await flushAsync();
        expect(inFlight).toHaveLength(2);
    });

    it('坐标集合不变时不会重复建批次', async () => {
        const inFlight: Array<{ request: SubtitleTranslationBatchRequest<TestContext>; deferred: DeferredBatch }> = [];
        const scheduler = new SubtitleTranslationScheduler<TestContext>({
            executeBatch: (request) => {
                const deferred = createDeferred();
                inFlight.push({ request, deferred });
                return deferred.promise;
            },
        });

        scheduler.updateDemand(buildDemand());
        expect(inFlight).toHaveLength(2);
        for (const batch of inFlight) {
            batch.deferred.resolve({ completedIndices: batch.request.indices, failedIndices: [], cancelled: false });
        }
        await flushAsync();

        // 播放位置推进但坐标集合不变：不能因为「集合未变」判定失效而重复翻译。
        scheduler.updateDemand(buildDemand({ demandId: 2, currentIndex: 5 }));
        await flushAsync();
        expect(inFlight).toHaveLength(2);
    });
});
