import {
    type ConcurrencyProfiles,
    defaultConcurrencyProfiles,
    type RateLimiterProfile,
    type SchedulerProfile,
    type SemaphoreProfile,
} from '@/backend/utils/concurrency/config/ConcurrencyProfiles';
import { AsyncLocalStorage } from 'async_hooks';
import {
    type CooperativeScheduler,
    createCooperativeScheduler,
} from '@/backend/utils/concurrency/primitives/CooperativeScheduler';
import { createMutex, type Mutex } from '@/backend/utils/concurrency/primitives/Mutex';
import { createRateLimiter, type RateLimiter } from '@/backend/utils/concurrency/primitives/RateLimiter';
import { createSemaphore, type Semaphore } from '@/backend/utils/concurrency/primitives/Semaphore';
import {
    type ConcurrencyLogger,
    type ConcurrencyLoggerRef,
    type KernelAcquireOptions,
    LockOrderViolationError,
    type Permit,
    type WaitTurnOptions,
} from '@/backend/utils/concurrency/types';

type LockKind = 'semaphore' | 'mutex';

type LockRank = {
    tier: number;
    configuredOrder: number;
    key: string;
};

type HeldLock = {
    lockId: string;
    key: string;
    kind: LockKind;
    rank: LockRank;
};

type ReentrantEntry = {
    depth: number;
    basePermit: Permit;
};

type ConcurrencyContext = {
    heldLocks: HeldLock[];
    reentrantPermits: Map<string, ReentrantEntry>;
};

/**
 * 并发内核对外接口。
 */
export interface ConcurrencyKernel {
    /**
     * 按 key 获取信号量实例。
     * @param key 配置键。
     * @returns 信号量实例。
     */
    semaphore(key: string): Semaphore;
    /**
     * 按 key 获取互斥锁实例。
     * @param key 配置键。
     * @returns 互斥锁实例。
     */
    mutex(key: string): Mutex;
    /**
     * 按 key 获取速率限制器实例。
     * @param key 配置键。
     * @returns 速率限制器实例。
     */
    rateLimiter(key: string): RateLimiter;
    /**
     * 按 key 获取调度器实例。
     * @param key 可选键，缺省为 default。
     * @returns 调度器实例。
     */
    scheduler(key?: string): CooperativeScheduler;
    /**
     * 在信号量保护下执行任务。
     * @param key 信号量键。
     * @param task 任务函数。
     * @param options 获取许可选项。
     */
    withSemaphore<T>(key: string, task: () => Promise<T>, options?: KernelAcquireOptions): Promise<T>;
    /**
     * 获取信号量许可。
     * @param key 信号量键。
     * @param options 获取许可选项。
     */
    acquire(key: string, options?: KernelAcquireOptions): Promise<Permit>;
    /**
     * 在互斥锁保护下执行任务，纳入统一并发上下文、锁顺序校验与可选重入控制。
     * @param key 互斥锁键。
     * @param task 任务函数。
     * @param options 获取许可选项。
     */
    withMutex<T>(key: string, task: () => Promise<T>, options?: KernelAcquireOptions): Promise<T>;
    /**
     * 在速率限制保护下执行任务。
     * @param key 速率限制键。
     * @param task 任务函数。
     * @param options 等待放行选项。
     */
    withRateLimit<T>(key: string, task: () => Promise<T>, options?: WaitTurnOptions): Promise<T>;
    /**
     * 等待速率限制放行。
     * @param key 速率限制键。
     * @param options 等待放行选项。
     */
    waitTurn(key: string, options?: WaitTurnOptions): Promise<void>;
    /**
     * 对指定调度器执行一次按预算让步。
     * @param key 调度器键，缺省为 default。
     */
    yieldIfNeeded(key?: string): Promise<void>;
    /**
     * 注入/更新日志端口；由组合根在运行期调用，undefined 关闭并发内核日志。
     * @param logger 日志端口。
     */
    setLogger(logger: ConcurrencyLogger | undefined): void;
}

/**
 * 创建新的并发调用链上下文。
 * @returns 并发上下文。
 */
function createConcurrencyContext(): ConcurrencyContext {
    return {
        heldLocks: [],
        reentrantPermits: new Map(),
    };
}

/**
 * 深度合并并发配置。
 * @param base 基础配置。
 * @param override 覆盖配置。
 * @returns 合并后的配置。
 */
function mergeProfiles(base: ConcurrencyProfiles, override?: Partial<ConcurrencyProfiles>): ConcurrencyProfiles {
    return {
        semaphore: {
            ...base.semaphore,
            ...(override?.semaphore ?? {}),
        },
        rateLimiter: {
            ...base.rateLimiter,
            ...(override?.rateLimiter ?? {}),
        },
        scheduler: {
            ...base.scheduler,
            ...(override?.scheduler ?? {}),
        },
        lockOrder: override?.lockOrder ?? base.lockOrder,
    };
}

/**
 * 构造互斥与信号量共用的统一锁序号映射。
 * 显式声明在 `lockOrder` 中的键按声明顺序排位，未声明的信号量键按字典序追加。
 *
 * @param profiles 已合并的并发配置。
 * @returns 键到序号的映射。
 */
function buildConfiguredOrderMap(profiles: ConcurrencyProfiles): Map<string, number> {
    const orderMap = new Map<string, number>();
    for (const key of profiles.lockOrder ?? []) {
        if (!orderMap.has(key)) {
            orderMap.set(key, orderMap.size);
        }
    }
    const extraSemaphoreKeys = Object.keys(profiles.semaphore).sort((a, b) => a.localeCompare(b));
    for (const key of extraSemaphoreKeys) {
        if (!orderMap.has(key)) {
            orderMap.set(key, orderMap.size);
        }
    }
    return orderMap;
}

/**
 * 解析锁的全局可比较序号。
 * - 已配置键进入第 1 层并按显式配置顺序比较；
 * - 未配置互斥锁位于第 0 层（外层业务锁），按字典序比较；
 * - 未配置信号量位于第 2 层，按字典序比较。
 *
 * @param key 锁键。
 * @param kind 原语类型。
 * @param orderMap 已配置顺序映射。
 * @returns 可比较的锁序结构。
 */
function resolveLockRank(key: string, kind: LockKind, orderMap: Map<string, number>): LockRank {
    const configured = orderMap.get(key);
    if (configured !== undefined) {
        return { tier: 1, configuredOrder: configured, key };
    }
    return { tier: kind === 'mutex' ? 0 : 2, configuredOrder: -1, key };
}

/**
 * 比较两把锁的获取顺序权重；返回值 > 0 表示 a 排在 b 之后。
 *
 * @param a 前锁序。
 * @param b 后锁序。
 * @returns 比较结果。
 */
function compareLockRank(a: LockRank, b: LockRank): number {
    if (a.tier !== b.tier) {
        return a.tier - b.tier;
    }
    if (a.tier === 1) {
        return a.configuredOrder - b.configuredOrder;
    }
    return a.key.localeCompare(b.key);
}

/**
 * 创建全局并发内核实例。
 * @param overrideProfiles 可选覆盖配置。
 * @param logger 初始日志端口；也可通过 setLogger 在运行期注入/更新。
 * @returns 并发内核实例。
 */
export function createConcurrencyKernel(
    overrideProfiles?: Partial<ConcurrencyProfiles>,
    logger?: ConcurrencyLogger,
): ConcurrencyKernel {
    const profiles = mergeProfiles(defaultConcurrencyProfiles, overrideProfiles);
    const semaphoreInstances = new Map<string, Semaphore>();
    const mutexInstances = new Map<string, Mutex>();
    const rateLimiterInstances = new Map<string, RateLimiter>();
    const schedulerInstances = new Map<string, CooperativeScheduler>();
    const contextStorage = new AsyncLocalStorage<ConcurrencyContext>();
    // 可变引用：组合根可在运行期注入/更新，已创建的原语也能立即生效。
    const loggerRef: ConcurrencyLoggerRef = { current: logger };
    const configuredOrder = buildConfiguredOrderMap(profiles);

    /**
     * 在并发上下文中运行任务；若当前无上下文则创建隔离上下文。
     * @param task 需要执行的任务。
     * @returns 任务结果。
     */
    function runWithContext<T>(task: () => Promise<T>): Promise<T> {
        const existing = contextStorage.getStore();
        if (existing) {
            return task();
        }
        return contextStorage.run(createConcurrencyContext(), task);
    }

    /**
     * 读取当前并发上下文；若不存在则抛错。
     * @returns 当前上下文。
     */
    function getContextOrThrow(): ConcurrencyContext {
        const context = contextStorage.getStore();
        if (!context) {
            throw new Error('并发上下文不存在，请通过 withSemaphore/withMutex/acquire 进入并发上下文');
        }
        return context;
    }

    /**
     * 对锁获取执行统一顺序校验（覆盖互斥锁与信号量）。
     * @param context 当前并发上下文。
     * @param key 目标锁键。
     * @param kind 原语类型。
     * @param options 获取选项。
     */
    function assertLockOrder(
        context: ConcurrencyContext,
        key: string,
        kind: LockKind,
        options?: KernelAcquireOptions,
    ): void {
        if (options?.skipOrderCheck) {
            return;
        }
        const targetLockId = `${kind}:${key}`;
        const targetRank = resolveLockRank(key, kind, configuredOrder);
        // 重复获取判定依据是「当前上下文已实际持有该锁」（heldLocks 只含 acquire 成功且未释放的锁），
        // 不是「有别的获取在排队」：同一上下文内 Promise.all 同步调度的两个分支取同键锁，
        // 后者在前者持锁前就会完成本检查，因此走正常排队，不会误报。
        // 已知窄窗口：同一上下文中后启动的兄弟协程去等先启动兄弟已持有的同键互斥/容量 1 信号量，
        // 会在这里抛错而不是排队。当前代码库无此调用模式；若未来出现，应改用容量 > 1 的信号量
        // 或把两个分支拆到独立上下文，而不是放宽本检查（它挡住的是真实的同栈自死锁）。
        const isDuplicateNonReentrant = context.heldLocks.some(
            (held) => held.lockId === targetLockId && (kind === 'mutex' || getSemaphoreProfile(key).capacity <= 1),
        );
        const hasViolation = isDuplicateNonReentrant
            || context.heldLocks.some((held) => compareLockRank(held.rank, targetRank) > 0);
        if (hasViolation) {
            const heldKeys = context.heldLocks.map((lock) => lock.key).join(', ');
            throw new LockOrderViolationError(
                `锁顺序违规：尝试获取 ${key}，当前已持有 [${heldKeys}]，请按预定义顺序获取`,
            );
        }
    }

    /**
     * 在上下文中登记已持有锁。
     * @param context 当前并发上下文。
     * @param lockId 含原语类型的唯一锁标识。
     * @param key 锁键。
     * @param kind 原语类型。
     */
    function pushHeldLock(context: ConcurrencyContext, lockId: string, key: string, kind: LockKind): void {
        context.heldLocks.push({
            lockId,
            key,
            kind,
            rank: resolveLockRank(key, kind, configuredOrder),
        });
    }

    /**
     * 在上下文中移除一条已持有锁记录。
     * @param context 当前并发上下文。
     * @param lockId 含原语类型的唯一锁标识。
     */
    function popHeldLock(context: ConcurrencyContext, lockId: string): void {
        for (let index = context.heldLocks.length - 1; index >= 0; index--) {
            if (context.heldLocks[index].lockId === lockId) {
                context.heldLocks.splice(index, 1);
                return;
            }
        }
    }

    /**
     * 构造带上下文出栈与重入计数清理逻辑的许可包装。
     * @param context 当前并发上下文。
     * @param lockId 含原语类型的唯一锁标识。
     * @param key 锁键。
     * @param kind 原语类型。
     * @param onRelease 真正释放底层许可的回调。
     * @returns 包装许可。
     */
    function wrapPermitWithContext(
        context: ConcurrencyContext,
        lockId: string,
        key: string,
        kind: LockKind,
        onRelease: () => void,
    ): Permit {
        let released = false;
        pushHeldLock(context, lockId, key, kind);
        return {
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                popHeldLock(context, lockId);
                onRelease();
            },
        };
    }

    /**
     * 统一在并发上下文中获取互斥锁或信号量许可，支持锁顺序校验与可控重入。
     * @param kind 原语类型。
     * @param key 锁键。
     * @param options 获取选项。
     * @returns 包装后的许可句柄。
     */
    async function acquireWithContext(
        kind: LockKind,
        key: string,
        options?: KernelAcquireOptions,
    ): Promise<Permit> {
        return await runWithContext(async () => {
            const context = getContextOrThrow();
            const lockId = `${kind}:${key}`;

            if (options?.reentrant) {
                const current = context.reentrantPermits.get(lockId);
                if (current) {
                    current.depth += 1;
                    return wrapPermitWithContext(context, lockId, key, kind, () => {
                        current.depth -= 1;
                        if (current.depth <= 0) {
                            context.reentrantPermits.delete(lockId);
                            current.basePermit.release();
                        }
                    });
                }
            }

            assertLockOrder(context, key, kind, options);
            const permit = kind === 'mutex'
                ? await kernel.mutex(key).acquire(options)
                : await kernel.semaphore(key).acquire(options);

            if (options?.reentrant) {
                const entry: ReentrantEntry = {
                    depth: 1,
                    basePermit: permit,
                };
                context.reentrantPermits.set(lockId, entry);
                return wrapPermitWithContext(context, lockId, key, kind, () => {
                    entry.depth -= 1;
                    if (entry.depth <= 0) {
                        context.reentrantPermits.delete(lockId);
                        entry.basePermit.release();
                    }
                });
            }

            return wrapPermitWithContext(context, lockId, key, kind, () => permit.release());
        });
    }

    /**
     * 读取信号量配置，若缺失则抛错。
     * @param key 配置键。
     * @returns 配置。
     */
    function getSemaphoreProfile(key: string): SemaphoreProfile {
        const profile = profiles.semaphore[key];
        if (!profile) {
            throw new Error(`未找到 semaphore 配置: ${key}`);
        }
        return profile;
    }

    /**
     * 读取速率限制配置，若缺失则抛错。
     * @param key 配置键。
     * @returns 配置。
     */
    function getRateLimiterProfile(key: string): RateLimiterProfile {
        const profile = profiles.rateLimiter[key];
        if (!profile) {
            throw new Error(`未找到 rateLimiter 配置: ${key}`);
        }
        return profile;
    }

    /**
     * 读取调度器配置，若缺失则抛错。
     * @param key 配置键。
     * @returns 配置。
     */
    function getSchedulerProfile(key: string): SchedulerProfile {
        const profile = profiles.scheduler[key];
        if (!profile) {
            throw new Error(`未找到 scheduler 配置: ${key}`);
        }
        return profile;
    }

    const kernel: ConcurrencyKernel = {
        semaphore(key: string): Semaphore {
            const cached = semaphoreInstances.get(key);
            if (cached) {
                return cached;
            }
            const profile = getSemaphoreProfile(key);
            const created = createSemaphore({ capacity: profile.capacity, name: key, logger: loggerRef });
            semaphoreInstances.set(key, created);
            return created;
        },

        mutex(key: string): Mutex {
            const cached = mutexInstances.get(key);
            if (cached) {
                return cached;
            }
            const created = createMutex({ name: key, logger: loggerRef });
            mutexInstances.set(key, created);
            return created;
        },

        rateLimiter(key: string): RateLimiter {
            const cached = rateLimiterInstances.get(key);
            if (cached) {
                return cached;
            }
            const profile = getRateLimiterProfile(key);
            const created = createRateLimiter({
                maxRequests: profile.maxRequests,
                windowMs: profile.windowMs,
                name: key,
                logger: loggerRef,
            });
            rateLimiterInstances.set(key, created);
            return created;
        },

        scheduler(key = 'default'): CooperativeScheduler {
            const cached = schedulerInstances.get(key);
            if (cached) {
                return cached;
            }
            const profile = getSchedulerProfile(key);
            const created = createCooperativeScheduler({
                name: key,
                timeSliceMs: profile.timeSliceMs,
                yieldDelayMs: profile.yieldDelayMs,
                logger: loggerRef,
            });
            schedulerInstances.set(key, created);
            return created;
        },

        async withSemaphore<T>(key: string, task: () => Promise<T>, options?: KernelAcquireOptions): Promise<T> {
            return await runWithContext(async () => {
                const permit = await acquireWithContext('semaphore', key, options);
                try {
                    return await task();
                } finally {
                    permit.release();
                }
            });
        },

        acquire(key: string, options?: KernelAcquireOptions): Promise<Permit> {
            return acquireWithContext('semaphore', key, options);
        },

        async withMutex<T>(key: string, task: () => Promise<T>, options?: KernelAcquireOptions): Promise<T> {
            return await runWithContext(async () => {
                const permit = await acquireWithContext('mutex', key, options);
                try {
                    return await task();
                } finally {
                    permit.release();
                }
            });
        },

        withRateLimit<T>(key: string, task: () => Promise<T>, options?: WaitTurnOptions): Promise<T> {
            return this.rateLimiter(key).schedule(task, options);
        },

        waitTurn(key: string, options?: WaitTurnOptions): Promise<void> {
            return this.rateLimiter(key).waitTurn(options);
        },

        async yieldIfNeeded(key = 'default'): Promise<void> {
            await this.scheduler(key).yieldIfNeeded();
        },

        setLogger(nextLogger: ConcurrencyLogger | undefined): void {
            loggerRef.current = nextLogger;
        },
    };

    return kernel;
}
