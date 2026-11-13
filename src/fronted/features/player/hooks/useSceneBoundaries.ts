import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

import type { SceneBoundary, SceneSentence } from '@/common/learning/sceneSegmentation';
import type { Sentence } from '@/common/types/SentenceC';
import { playerApi } from '@/fronted/features/player/playerApi';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import useSetting from '@/fronted/features/settings/settingsStore';

interface SceneBoundariesState {
    /** 最近一次请求键与对应结果；键变化时旧结果自动失效。 */
    resolvedKey: string | null;
    boundaries: SceneBoundary[];
    inFlightKey: string | null;
    setResolved: (key: string, boundaries: SceneBoundary[]) => void;
    setInFlight: (key: string | null) => void;
    reset: () => void;
}

const useSceneBoundariesStore = create<SceneBoundariesState>((set) => ({
    resolvedKey: null,
    boundaries: [],
    inFlightKey: null,
    setResolved: (key, boundaries) => set({
        resolvedKey: key,
        boundaries,
        inFlightKey: null,
    }),
    setInFlight: (key) => set({ inFlightKey: key }),
    reset: () => set({
        resolvedKey: null,
        boundaries: [],
        inFlightKey: null,
    }),
}));

/** 测试专用：清空场景边界缓存，避免跨用例复用旧结果。 */
export const resetSceneBoundariesCache = (): void => {
    useSceneBoundariesStore.getState().reset();
};

/**
 * 订阅当前字幕的场景边界。
 *
 * 主字幕区的换人提示与右侧字幕栏的场景分割线共享同一份 IPC 结果，
 * 避免切换或同时渲染两个区域时重复触发后端计算。
 */
export const useSceneBoundaries = (sentences: Sentence[]): SceneBoundary[] => {
    const enabled = useSetting((state) => state.values.get('player.sceneCues') ?? 'false') === 'true';
    const videoPath = usePlaybackSession((state) => state.videoPath);

    const sceneSentences = useMemo<SceneSentence[]>(() => sentences.map((sentence) => ({
        fileHash: sentence.fileHash,
        index: sentence.index,
        start: sentence.start,
        end: sentence.end,
        text: sentence.text,
    })), [sentences]);

    const fileHash = sceneSentences[0]?.fileHash ?? null;
    const requestKey = enabled && sceneSentences.length >= 2 && fileHash
        ? `${fileHash}:${sceneSentences.length}:${videoPath ?? ''}`
        : null;

    const resolvedKey = useSceneBoundariesStore((state) => state.resolvedKey);
    const storedBoundaries = useSceneBoundariesStore((state) => state.boundaries);

    useEffect(() => {
        if (!requestKey) {
            return;
        }
        const state = useSceneBoundariesStore.getState();
        if (state.resolvedKey === requestKey || state.inFlightKey === requestKey) {
            return;
        }
        state.setInFlight(requestKey);
        let cancelled = false;
        playerApi.getSceneBoundaries(sceneSentences, videoPath ?? undefined)
            .then((result) => {
                if (!cancelled) {
                    useSceneBoundariesStore.getState().setResolved(requestKey, result);
                }
            })
            .catch(() => {
                // 场景提示是可选增强，取不到就静默隐藏，不回退到前端重算。
                if (!cancelled) {
                    useSceneBoundariesStore.getState().setResolved(requestKey, []);
                }
            });
        return () => {
            cancelled = true;
            if (useSceneBoundariesStore.getState().inFlightKey === requestKey) {
                useSceneBoundariesStore.getState().setInFlight(null);
            }
        };
    }, [requestKey, sceneSentences, videoPath]);

    return useMemo<SceneBoundary[]>(
        () => (requestKey && resolvedKey === requestKey ? storedBoundaries : []),
        [requestKey, resolvedKey, storedBoundaries],
    );
};
