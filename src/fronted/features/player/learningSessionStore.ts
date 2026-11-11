import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * 学习会话锚点：视频或字幕变化时重置，弹层开关不影响开始时间。
 */
interface LearningSessionState {
    /** 当前会话键；没有视频或字幕绑定时为 null。 */
    key: string | null;
    /** 当前会话开始时间（ISO 8601）。 */
    since: string | null;
    /** 根据播放上下文同步会话锚点。 */
    sync: (videoId: string | null, fileHash: string | null) => void;
}

/**
 * 构造稳定的播放会话键。
 *
 * videoId 与 fileHash 至少有一个才算有效会话；两者都缺失时不统计，
 * 避免播放器尚未绑定媒体时产生空摘要查询。
 */
export const buildLearningSessionKey = (
    videoId: string | null,
    fileHash: string | null,
): string | null => {
    if (!videoId && !fileHash) {
        return null;
    }
    return `${videoId ?? ''}::${fileHash ?? ''}`;
};

export const useLearningSessionStore = create<LearningSessionState>((set, get) => ({
    key: null,
    since: null,
    sync: (videoId, fileHash) => {
        const nextKey = buildLearningSessionKey(videoId, fileHash);
        const current = get();
        if (!nextKey) {
            if (current.key !== null) {
                set({ key: null, since: null });
            }
            return;
        }
        if (current.key !== nextKey || !current.since) {
            set({ key: nextKey, since: new Date().toISOString() });
        }
    },
}));

/**
 * 获取当前播放上下文的学习会话开始时间。
 *
 * 返回的 since 只在会话键匹配时有效，切换视频后不会短暂复用上一会话的锚点。
 */
export const useLearningSessionSince = (
    videoId: string | null,
    fileHash: string | null,
): { key: string | null; since: string | null } => {
    const key = buildLearningSessionKey(videoId, fileHash);
    const since = useLearningSessionStore((state) => (state.key === key ? state.since : null));

    useEffect(() => {
        useLearningSessionStore.getState().sync(videoId, fileHash);
    }, [videoId, fileHash]);

    return { key, since: key ? since : null };
};
