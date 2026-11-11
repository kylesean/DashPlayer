/**
 * 管理播放器生词表、词形映射和基于词形的命中判断。
 *
 * 词表以 Set 存储：字幕每个词渲染都会查询命中，数组扫描在词表较大时是热路径瓶颈。
 */
import { create } from 'zustand';
import {
    isActiveWordStatus,
    type WordStatus,
} from '@/common/types/vocabulary';

type VocabularyFormsMap = Record<string, string>;

interface VocabularyState {
    /** 生词基础形态集合。 */
    vocabularyWords: Set<string>;
    /** 当前字幕命中词的学习状态；与 vocabularyWords 分开，known/ignored 不参与高亮。 */
    wordStatuses: Record<string, WordStatus>;
    /** 不同形态 -> 基础形态的映射。 */
    vocabularyForms: VocabularyFormsMap;
    version: number;
    setVocabularyWords: (words: string[]) => void;
    setVocabularyStates: (states: Record<string, WordStatus>) => void;
    setVocabularyForms: (forms: VocabularyFormsMap) => void;
    addVocabularyWords: (words: string[]) => void;
    setWordStatus: (word: string, status: WordStatus) => void;
    removeVocabularyWords: (words: string[]) => void;
    clearVocabularyWords: () => void;
    isVocabularyWord: (word: string) => boolean;
    getWordStatus: (word: string) => WordStatus | undefined;
    getBaseWord: (word: string) => string | undefined;
}

const normalizeWord = (word: string): string | null => {
    if (!word) {
        return null;
    }
    const normalized = word.toLowerCase().trim();
    return normalized.length > 0 ? normalized : null;
};

const activeWordsFromStatuses = (statuses: Record<string, WordStatus>): Set<string> => {
    const active = new Set<string>();
    Object.entries(statuses).forEach(([word, status]) => {
        if (isActiveWordStatus(status)) {
            active.add(word);
        }
    });
    return active;
};

const useVocabularyStore = create<VocabularyState>((set, get) => ({
    vocabularyWords: new Set<string>(),
    wordStatuses: {},
    vocabularyForms: {},
    version: 0,

    setVocabularyWords: (words: string[]) => {
        const normalized = new Set<string>();
        const statuses: Record<string, WordStatus> = {};
        for (const word of words) {
            const cleaned = normalizeWord(word);
            if (cleaned) {
                normalized.add(cleaned);
                statuses[cleaned] = 'learning';
            }
        }
        set((state) => ({
            vocabularyWords: normalized,
            wordStatuses: statuses,
            version: state.version + 1
        }));
    },

    setVocabularyStates: (states: Record<string, WordStatus>) => {
        const statuses: Record<string, WordStatus> = {};
        for (const [word, status] of Object.entries(states ?? {})) {
            const cleaned = normalizeWord(word);
            if (cleaned) {
                statuses[cleaned] = status;
            }
        }
        set((state) => ({
            wordStatuses: statuses,
            vocabularyWords: activeWordsFromStatuses(statuses),
            version: state.version + 1,
        }));
    },

    setVocabularyForms: (forms: VocabularyFormsMap) => {
        const sanitizedEntries = Object.entries(forms || {}).reduce<VocabularyFormsMap>((acc, [form, base]) => {
            const normalizedForm = normalizeWord(form);
            const normalizedBase = normalizeWord(base);
            if (normalizedForm && normalizedBase) {
                acc[normalizedForm] = normalizedBase;
            }
            return acc;
        }, {});

        set((state) => ({
            vocabularyForms: sanitizedEntries,
            version: state.version + 1
        }));
    },

    addVocabularyWords: (words: string[]) => {
        const normalized = words
            .map(normalizeWord)
            .filter((word): word is string => !!word);
        if (normalized.length === 0) {
            return;
        }

        set((state) => {
            const combined = new Set(state.vocabularyWords);
            const statuses = { ...state.wordStatuses };
            for (const word of normalized) {
                combined.add(word);
                statuses[word] = 'learning';
            }
            return {
                vocabularyWords: combined,
                wordStatuses: statuses,
                version: state.version + 1
            };
        });
    },

    setWordStatus: (word: string, status: WordStatus) => {
        const normalized = normalizeWord(word);
        if (!normalized) {
            return;
        }
        set((state) => {
            const statuses = { ...state.wordStatuses, [normalized]: status };
            return {
                wordStatuses: statuses,
                vocabularyWords: activeWordsFromStatuses(statuses),
                version: state.version + 1,
            };
        });
    },

    /**
     * 从生词表中移除单词；同步清理指向被删基础形态的变体映射。
     *
     * 词表变化会递增 version，驱动依赖词表的组件（如裁切状态重检）。
     */
    removeVocabularyWords: (words: string[]) => {
        const normalized = words
            .map(normalizeWord)
            .filter((word): word is string => !!word);
        if (normalized.length === 0) {
            return;
        }

        set((state) => {
            const remaining = new Set(state.vocabularyWords);
            const statuses = { ...state.wordStatuses };
            let removed = false;
            for (const word of normalized) {
                if (remaining.delete(word)) {
                    removed = true;
                }
                if (statuses[word]) {
                    delete statuses[word];
                    removed = true;
                }
            }
            // 被删基础形态的变体映射也要清理，否则变体仍会被判为生词。
            const removedSet = new Set(normalized);
            const forms = Object.fromEntries(
                Object.entries(state.vocabularyForms).filter(([, base]) => !removedSet.has(base))
            );
            if (!removed && Object.keys(forms).length === Object.keys(state.vocabularyForms).length) {
                return state;
            }
            return {
                vocabularyWords: remaining,
                wordStatuses: statuses,
                vocabularyForms: forms,
                version: state.version + 1
            };
        });
    },

    clearVocabularyWords: () => {
        set((state) => ({
            vocabularyWords: new Set<string>(),
            wordStatuses: {},
            vocabularyForms: {},
            version: state.version + 1
        }));
    },

    isVocabularyWord: (word: string) => {
        const normalized = normalizeWord(word);
        if (!normalized) {
            return false;
        }
        const { vocabularyWords, vocabularyForms, wordStatuses } = get();
        const status = wordStatuses[normalized];
        if (status && isActiveWordStatus(status)) {
            return true;
        }
        if (vocabularyForms[normalized]) {
            const baseStatus = wordStatuses[vocabularyForms[normalized]];
            return !!baseStatus && isActiveWordStatus(baseStatus);
        }
        return vocabularyWords.has(normalized);
    },

    getWordStatus: (word: string) => {
        const normalized = normalizeWord(word);
        return normalized ? get().wordStatuses[normalized] : undefined;
    },

    getBaseWord: (word: string) => {
        const normalized = normalizeWord(word);
        if (!normalized) {
            return undefined;
        }
        const { vocabularyForms, vocabularyWords } = get();
        if (vocabularyForms[normalized]) {
            return vocabularyForms[normalized];
        }
        return vocabularyWords.has(normalized) ? normalized : undefined;
    }
	}));

/**
 * 按选择器订阅生词表状态；多字段选择请配合 `useShallow`。
 *
 * @param selector 状态选择器。
 * @returns 选中的生词表状态切片。
 */
export function useVocabularyState<T>(
    selector: (s: VocabularyState) => T,
): T {
    return useVocabularyStore(selector);
}

export { useVocabularyStore };
export default useVocabularyStore;
