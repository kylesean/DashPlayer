import {
    filterTranscriptSentences,
    sentenceVocabularyKey,
    type SentenceVocabularyCount,
    type TranscriptVocabularyFilter,
} from '@/frontend/features/player/transcriptVocabulary';
import { cleanWord, isWordToken, splitWords } from '@/common/utils/subtitle';
import type { WordStatus } from '@/common/types/vocabulary';
import type { Sentence } from '@/common/types/SentenceC';

export type ScriptReaderFilter = TranscriptVocabularyFilter | 'saved';

export interface ScriptVocabPreviewItem {
    word: string;
    count: number;
    firstSentenceIndex: number;
}

const PROGRESS_STORAGE_KEY = 'refrain:script-reader-progress';
const MAX_STORED_PROGRESS = 120;

const readProgressMap = (): Record<string, number> => {
    try {
        if (typeof localStorage === 'undefined') {
            return {};
        }
        const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object') return {};
        const clean: Record<string, number> = {};
        for (const [key, val] of Object.entries(parsed)) {
            if (typeof val === 'number' && Number.isInteger(val) && val >= 0) {
                clean[key] = val;
            }
        }
        return clean;
    } catch {
        return {};
    }
};

export const getSavedReaderProgress = (videoId: string): number | null => {
    if (!videoId) return null;
    const map = readProgressMap();
    return typeof map[videoId] === 'number' ? map[videoId] : null;
};

/**
 * 获取最近一次精读文稿的进度记录（依赖 saveReaderProgress 维护的插入顺序）。
 */
export const getLatestSavedReaderProgress = (): { videoId: string; sentenceIndex: number } | null => {
    const entries = Object.entries(readProgressMap());
    if (entries.length === 0) return null;
    const [videoId, sentenceIndex] = entries[entries.length - 1];
    return { videoId, sentenceIndex };
};

export const saveReaderProgress = (videoId: string, sentenceIndex: number): void => {
    if (!videoId || !Number.isInteger(sentenceIndex) || sentenceIndex < 0) {
        return;
    }
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }
        const map = readProgressMap();
        // 删除重插保持最近访问顺序，避免本地存储无限增长
        delete map[videoId];
        map[videoId] = sentenceIndex;
        const keys = Object.keys(map);
        if (keys.length > MAX_STORED_PROGRESS) {
            for (const staleKey of keys.slice(0, keys.length - MAX_STORED_PROGRESS)) {
                delete map[staleKey];
            }
        }
        localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // 忽略存储限制错误，不影响阅读体验
    }
};

/**
 * 综合状态筛选（全部 / 含生词 / 有印象 / 已收藏金句）与关键词搜索。
 */
export const filterReaderSentences = (params: {
    sentences: Sentence[];
    filter: ScriptReaderFilter;
    query: string;
    countOf: (sentence: Sentence) => SentenceVocabularyCount;
    savedKeys: ReadonlySet<string>;
    translations?: ReadonlyMap<string, string>;
}): Sentence[] => {
    const { sentences, filter, query, countOf, savedKeys, translations } = params;

    let stage: Sentence[];
    if (filter === 'saved') {
        stage = sentences.filter((s) => savedKeys.has(sentenceVocabularyKey(s)));
    } else {
        stage = filterTranscriptSentences(sentences, filter, countOf, undefined);
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return stage;
    }
    return stage.filter((s) => {
        const aiZh = s.translationKey ? translations?.get(s.translationKey) : undefined;
        return (
            s.text.toLowerCase().includes(normalizedQuery)
            || (s.textZH && s.textZH.toLowerCase().includes(normalizedQuery))
            || (aiZh && aiZh.toLowerCase().includes(normalizedQuery))
        );
    });
};

/**
 * 提取本篇文稿中的重点生词雷达（按出现频次降序），供听前快速扫盲。
 */
export const collectReaderVocabularySummary = (
    sentences: readonly Sentence[],
    resolveStatus: (word: string, lemma?: string) => WordStatus | undefined,
    limit = 12,
): ScriptVocabPreviewItem[] => {
    const map = new Map<string, ScriptVocabPreviewItem>();

    for (const sentence of sentences) {
        const parts = sentence.struct?.blocks?.flatMap((b) => b.blockParts) ?? [];
        const tokens = parts.length > 0
            ? parts
                .filter((p) => p.isWord && p.content.trim().length > 0)
                .map((p) => ({ word: p.content, lemma: p.lemma }))
            : splitWords(sentence.text ?? '')
                .filter(isWordToken)
                .map((token) => ({ word: token, lemma: cleanWord(token) }));

        for (const token of tokens) {
            const status = resolveStatus(token.word, token.lemma);
            if (status !== 'learning') {
                continue;
            }
            const normalized = (token.lemma || cleanWord(token.word) || token.word).toLowerCase().trim();
            if (!normalized) continue;
            const existing = map.get(normalized);
            if (existing) {
                existing.count += 1;
            } else {
                map.set(normalized, {
                    word: normalized,
                    count: 1,
                    firstSentenceIndex: sentence.index,
                });
            }
        }
    }

    return [...map.values()]
        .sort((a, b) => b.count - a.count || a.firstSentenceIndex - b.firstSentenceIndex)
        .slice(0, limit);
};
