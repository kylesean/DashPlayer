import { injectable } from 'inversify';

import type { SrtSentence } from '@/common/types/SentenceC';
import type { WordContextInsight } from '@/common/types/wordInsight';
import type { LearningRecapVO, RetellEvaluationVO } from '@/common/types/learningRecap';

/**
 * 缓存命名空间与对应值类型。
 */
export type CacheType = {
    'cache:srt': SrtSentence;
    'cache:srt-vocabulary-texts': string[];
    'cache:word-insight': WordContextInsight;
    'cache:learning-recap': LearningRecapVO;
    'cache:retell-feedback': RetellEvaluationVO;
};

/**
 * CacheService 的业务契约。
 */
export default interface CacheService {
    /**
     * 读取缓存值，并在值已过期时立即删除。
     *
     * @param type 缓存命名空间。
     * @param key 业务键。
     * @returns 缓存值；不存在或已过期时返回 `null`。
     */
    get<T extends keyof CacheType>(type: T, key: string): CacheType[T] | null;

    /**
     * 写入缓存值。
     *
     * @param type 缓存命名空间。
     * @param key 业务键。
     * @param value 缓存值。
     * @param ttl 可选有效期，单位为毫秒；不传时不会自动过期。
     */
    set<T extends keyof CacheType>(type: T, key: string, value: CacheType[T], ttl?: number): void;

    /**
     * 删除指定缓存值。
     *
     * @param type 缓存命名空间。
     * @param key 业务键。
     */
    delete<T extends keyof CacheType>(type: T, key: string): void;

    /**
     * 清空当前进程中的全部缓存。
     */
    clear(): void;
}



/**
 * 命名空间最大缓存容量限制（防止长会话内存无界增长）。
 */
const DEFAULT_MAX_ENTRIES: Record<keyof CacheType, number> = {
    'cache:srt': 32,
    'cache:srt-vocabulary-texts': 64,
    'cache:word-insight': 128,
    'cache:learning-recap': 64,
    'cache:retell-feedback': 128,
};

/**
 * 提供进程内的内存缓存（带 LRU 淘汰与过期时间支持，避免大对象无界膨胀）。
 */
@injectable()
export class CacheServiceImpl implements CacheService {
    private readonly stores: { [K in keyof CacheType]: Map<string, { value: unknown; expires?: number }> } = {
        'cache:srt': new Map(),
        'cache:srt-vocabulary-texts': new Map(),
        'cache:word-insight': new Map(),
        'cache:learning-recap': new Map(),
        'cache:retell-feedback': new Map(),
    };

    /**
     * 读取缓存值，并在值已过期时立即删除；命中有效缓存时刷新 LRU 访问热度。
     *
     * @param type 缓存命名空间。
     * @param key 业务键。
     * @returns 缓存值；不存在或已过期时返回 `null`。
     */
    public get<T extends keyof CacheType>(type: T, key: string): CacheType[T] | null {
        const store = this.stores[type];
        const item = store.get(key);
        if (!item) {
            return null;
        }

        if (item.expires && Date.now() > item.expires) {
            store.delete(key);
            return null;
        }

        // 刷新 LRU 顺序：移动到 Map 末尾
        store.delete(key);
        store.set(key, item);

        return item.value as CacheType[T];
    }

    /**
     * 写入缓存值，并在超出命名空间容量时淘汰最久未访问的条目。
     *
     * @param type 缓存命名空间。
     * @param key 业务键。
     * @param value 缓存值。
     * @param ttl 可选有效期，单位为毫秒；不传时不会自动过期。
     */
    public set<T extends keyof CacheType>(type: T, key: string, value: CacheType[T], ttl?: number): void {
        const store = this.stores[type];
        const maxEntries = DEFAULT_MAX_ENTRIES[type] ?? 32;

        if (store.has(key)) {
            store.delete(key);
        } else if (store.size >= maxEntries) {
            // 淘汰最久未访问（Map 头部）的项
            const oldestKey = store.keys().next().value;
            if (oldestKey !== undefined) {
                store.delete(oldestKey);
            }
        }

        const expires = ttl ? Date.now() + ttl : undefined;
        store.set(key, {
            value,
            expires,
        });
    }

    /**
     * 删除指定缓存值。
     *
     * @param type 缓存命名空间。
     * @param key 业务键。
     */
    public delete<T extends keyof CacheType>(type: T, key: string): void {
        this.stores[type].delete(key);
    }

    /**
     * 清空当前进程中的全部缓存。
     */
    public clear(): void {
        for (const store of Object.values(this.stores)) {
            store.clear();
        }
    }
}
