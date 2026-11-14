import { create } from 'zustand';
import { contextStudioApi } from './contextStudioApi';
import type { SaveSentenceInput } from '@/common/types/contextStudio';

interface SavedSentencesState {
    savedKeys: Set<string>;
    loadedVideoId: string | null;
    loadForVideo: (videoId: string) => Promise<void>;
    isSaved: (sentenceKey: string) => boolean;
    toggleSentence: (input: SaveSentenceInput) => Promise<boolean>;
    markRemoved: (sentenceKey: string) => void;
}

export const useSavedSentences = create<SavedSentencesState>((set, get) => ({
    savedKeys: new Set<string>(),
    loadedVideoId: null,

    loadForVideo: async (videoId: string) => {
        if (!videoId) return;
        try {
            const keys = await contextStudioApi.listSavedKeys(videoId);
            set({ savedKeys: new Set(keys), loadedVideoId: videoId });
        } catch {
            // 忽略加载异常，不影响主播放流程
        }
    },

    isSaved: (sentenceKey: string) => get().savedKeys.has(sentenceKey),

    toggleSentence: async (input: SaveSentenceInput) => {
        const currentlySaved = get().savedKeys.has(input.sentenceKey);
        const optimistic = new Set(get().savedKeys);
        if (currentlySaved) {
            optimistic.delete(input.sentenceKey);
        } else {
            optimistic.add(input.sentenceKey);
        }
        set({ savedKeys: optimistic });

        try {
            if (currentlySaved) {
                await contextStudioApi.unsaveSentence(input.sentenceKey);
                return false;
            }
            await contextStudioApi.saveSentence(input);
            return true;
        } catch (error) {
            // 失败时回滚乐观状态
            const rollback = new Set(get().savedKeys);
            if (currentlySaved) {
                rollback.add(input.sentenceKey);
            } else {
                rollback.delete(input.sentenceKey);
            }
            set({ savedKeys: rollback });
            throw error;
        }
    },

    markRemoved: (sentenceKey: string) => {
        const next = new Set(get().savedKeys);
        if (next.delete(sentenceKey)) {
            set({ savedKeys: next });
        }
    },
}));
