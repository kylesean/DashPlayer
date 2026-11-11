import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildLearningSessionKey,
    useLearningSessionStore,
} from '@/fronted/features/player/learningSessionStore';

describe('learningSessionStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useLearningSessionStore.setState({ key: null, since: null });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('同一个视频与字幕保持会话开始时间稳定', () => {
        vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
        useLearningSessionStore.getState().sync('video-1', 'hash-1');
        const first = useLearningSessionStore.getState().since;

        vi.setSystemTime(new Date('2026-01-01T10:30:00.000Z'));
        useLearningSessionStore.getState().sync('video-1', 'hash-1');

        expect(useLearningSessionStore.getState().since).toBe(first);
    });

    it('视频或字幕变化时重置，播放上下文清空后回到无会话', () => {
        vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
        useLearningSessionStore.getState().sync('video-1', 'hash-1');
        const first = useLearningSessionStore.getState().since;

        vi.setSystemTime(new Date('2026-01-01T11:00:00.000Z'));
        useLearningSessionStore.getState().sync('video-2', 'hash-2');
        const second = useLearningSessionStore.getState().since;

        expect(second).not.toBe(first);
        expect(second).toBe('2026-01-01T11:00:00.000Z');

        useLearningSessionStore.getState().sync(null, null);
        expect(useLearningSessionStore.getState()).toMatchObject({ key: null, since: null });
    });

    it('videoId 与 fileHash 至少有一个时才会话有效', () => {
        expect(buildLearningSessionKey(null, null)).toBeNull();
        expect(buildLearningSessionKey('video-1', null)).toBe('video-1::');
        expect(buildLearningSessionKey(null, 'hash-1')).toBe('::hash-1');
    });
});
