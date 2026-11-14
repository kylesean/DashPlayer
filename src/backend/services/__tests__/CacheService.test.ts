import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheServiceImpl } from '../CacheService';
import type { SrtSentence } from '@/common/types/SentenceC';

describe('CacheServiceImpl', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('sets and gets cached values', () => {
        const cache = new CacheServiceImpl();
        const mockSrt = { fileHash: 'hash-1', sentences: [] } as unknown as SrtSentence;
        cache.set('cache:srt', 'hash-1', mockSrt);

        expect(cache.get('cache:srt', 'hash-1')).toBe(mockSrt);
        expect(cache.get('cache:srt', 'non-existent')).toBeNull();
    });

    it('expires items after TTL', () => {
        vi.useFakeTimers();
        const cache = new CacheServiceImpl();
        const mockSrt = { fileHash: 'hash-ttl', sentences: [] } as unknown as SrtSentence;
        cache.set('cache:srt', 'hash-ttl', mockSrt, 10);

        expect(cache.get('cache:srt', 'hash-ttl')).toBe(mockSrt);

        vi.advanceTimersByTime(15);
        expect(cache.get('cache:srt', 'hash-ttl')).toBeNull();
    });

    it('enforces LRU eviction when exceeding capacity', () => {
        const cache = new CacheServiceImpl();
        // cache:srt max capacity is 32
        for (let i = 0; i < 35; i++) {
            const srt = { fileHash: `hash-${i}`, sentences: [] } as unknown as SrtSentence;
            cache.set('cache:srt', `hash-${i}`, srt);
        }

        // The first 3 should have been evicted (35 - 32 = 3)
        expect(cache.get('cache:srt', 'hash-0')).toBeNull();
        expect(cache.get('cache:srt', 'hash-1')).toBeNull();
        expect(cache.get('cache:srt', 'hash-2')).toBeNull();

        // The 32 most recent should remain
        expect(cache.get('cache:srt', 'hash-3')).not.toBeNull();
        expect(cache.get('cache:srt', 'hash-34')).not.toBeNull();
    });

    it('refreshes LRU priority on access', () => {
        const cache = new CacheServiceImpl();
        // Fill 32 items: hash-0 to hash-31
        for (let i = 0; i < 32; i++) {
            const srt = { fileHash: `hash-${i}`, sentences: [] } as unknown as SrtSentence;
            cache.set('cache:srt', `hash-${i}`, srt);
        }

        // Access hash-0, making it recently used
        expect(cache.get('cache:srt', 'hash-0')).not.toBeNull();

        // Insert another item (hash-32)
        const srt32 = { fileHash: 'hash-32', sentences: [] } as unknown as SrtSentence;
        cache.set('cache:srt', 'hash-32', srt32);

        // hash-0 was refreshed, so hash-1 should have been evicted instead of hash-0
        expect(cache.get('cache:srt', 'hash-0')).not.toBeNull();
        expect(cache.get('cache:srt', 'hash-1')).toBeNull();
        expect(cache.get('cache:srt', 'hash-32')).not.toBeNull();
    });

    it('deletes and clears items', () => {
        const cache = new CacheServiceImpl();
        const mockSrt = { fileHash: 'hash-del', sentences: [] } as unknown as SrtSentence;
        cache.set('cache:srt', 'hash-del', mockSrt);
        expect(cache.get('cache:srt', 'hash-del')).toBe(mockSrt);

        cache.delete('cache:srt', 'hash-del');
        expect(cache.get('cache:srt', 'hash-del')).toBeNull();

        cache.set('cache:srt', 'hash-clear', mockSrt);
        cache.clear();
        expect(cache.get('cache:srt', 'hash-clear')).toBeNull();
    });
});
