/**
 * 右侧文稿的词汇状态统计与筛选。
 *
 * 文稿比主字幕多承担一件事：让用户看见「这段里有哪些词正在学」。因此它需要
 * 两个主字幕不该有的能力——句子级状态点，以及按状态筛选。
 *
 * 这里刻意把统计口径交给 `resolveVocabularyAnnotation`：状态点数量必须与正文里
 * 真正画出来的标记完全一致，否则「这一句 3 个生词」旁边却只看到 2 条下划线，
 * 用户会立刻失去信任。所以不要在别处另写一套判定。
 */
import { useMemo } from 'react';

import type { Sentence } from '@/common/types/SentenceC';
import { cleanWord, isWordToken, splitWords } from '@/common/utils/subtitle';
import {
    VOCABULARY_GUIDANCE_LEVELS,
    type VocabularyGuidance,
    type WordStatus,
} from '@/common/types/vocabulary';
import { useShallow } from 'zustand/react/shallow';

import { useVocabularyState } from '@/frontend/features/player/vocabularyStore';
import useSetting from '@/frontend/features/settings/settingsStore';
import { resolveVocabularyAnnotation } from '@/frontend/features/player/vocabularyAnnotations';

/**
 * 文稿筛选维度。
 *
 * 只按「会画出来的两种标记」筛选：`known / ignored` 在正文里不可见，
 * 让它们成为筛选项等于让用户筛出一片空列表。
 */
export type TranscriptVocabularyFilter = 'all' | 'learning' | 'familiar';

/** 一句里两类可见标记的出现次数。 */
export interface SentenceVocabularyCount {
    /** 待学词标记数量。 */
    learning: number;
    /** 有印象弱提示数量。 */
    familiar: number;
}

/** 零计数常量：避免空结果每次新建对象，让 memo 依赖保持稳定。 */
export const EMPTY_SENTENCE_VOCABULARY_COUNT: SentenceVocabularyCount = Object.freeze({
    learning: 0,
    familiar: 0,
});

/** 把一个词形解析为学习状态；由调用方注入词表查询能力。 */
export type WordStatusResolver = (word: string, lemma?: string) => WordStatus | undefined;

/**
 * 取出一句里所有需要判定的词。
 *
 * 优先用后端 NLP 分词给出的 lemma（与 `Word` 组件的高亮判定同源）；
 * 结构缺失时回退到标点/空格切词，保证旧字幕文件也能统计。
 */
const sentenceWords = (sentence: Sentence): Array<{ word: string; lemma?: string }> => {
    const parts = sentence.struct?.blocks?.flatMap((block) => block.blockParts) ?? [];
    const words = parts
        .filter((part) => part.isWord && part.content.trim().length > 0)
        .map((part) => ({ word: part.content, lemma: part.lemma }));
    if (words.length > 0) {
        return words;
    }
    return splitWords(sentence.text ?? '')
        .filter(isWordToken)
        .map((token) => ({ word: token, lemma: cleanWord(token) }));
};

/**
 * 统计一句里两类可见标记的出现次数。
 *
 * 统计的是「出现次数」而非「去重词数」：同一个词在一句里出现两次就有两条下划线，
 * 状态点也必须报 2，否则数字与视觉对不上。
 *
 * @param sentence 目标句。
 * @param resolveStatus 词形到学习状态的解析函数。
 * @param guidance 当前提示强度。
 * @returns 两类标记的数量。
 */
export function countSentenceVocabulary(
    sentence: Sentence | null | undefined,
    resolveStatus: WordStatusResolver,
    guidance: VocabularyGuidance,
): SentenceVocabularyCount {
    if (!sentence) {
        return EMPTY_SENTENCE_VOCABULARY_COUNT;
    }
    let learning = 0;
    let familiar = 0;
    for (const { word, lemma } of sentenceWords(sentence)) {
        const kind = resolveVocabularyAnnotation(resolveStatus(word, lemma), guidance, 'transcript');
        if (kind === 'learning') {
            learning += 1;
        } else if (kind === 'familiar') {
            familiar += 1;
        }
    }
    return learning === 0 && familiar === 0
        ? EMPTY_SENTENCE_VOCABULARY_COUNT
        : { learning, familiar };
}

/**
 * 按状态筛选文稿句子。
 *
 * `alwaysKeep` 用于保住正在播放的那一句：播放中列表突然把它筛掉，用户会以为
 * 播放器坏了。保留下来的句子不计入筛选结果，只作为上下文锚点。
 *
 * @param sentences 原始句子列表。
 * @param filter 筛选维度。
 * @param countOf 句子计数函数。
 * @param alwaysKeep 需要无条件保留的句子判定。
 * @returns 过滤后的句子列表；`all` 时原样返回。
 */
export function filterTranscriptSentences(
    sentences: Sentence[],
    filter: TranscriptVocabularyFilter,
    countOf: (sentence: Sentence) => SentenceVocabularyCount,
    alwaysKeep?: (sentence: Sentence) => boolean,
): Sentence[] {
    if (filter === 'all') {
        return sentences;
    }
    return sentences.filter(
        (sentence) => countOf(sentence)[filter] > 0 || alwaysKeep?.(sentence) === true,
    );
}

/**
 * 读取当前提示强度；非法或缺失时按「安静」处理，与 `Word` 的回退保持一致。
 */
export function useVocabularyGuidance(): VocabularyGuidance {
    const raw = useSetting((state) => state.values.get('player.vocabularyGuidance'));
    return VOCABULARY_GUIDANCE_LEVELS.includes(raw as VocabularyGuidance)
        ? (raw as VocabularyGuidance)
        : 'calm';
}

/**
 * 词表快照：三份数据都是纯值，组合后的对象由 `useShallow` 保持稳定，
 * 只有真正发生增删改时才换引用。
 */
export interface VocabularySnapshot {
    statuses: Record<string, WordStatus>;
    forms: Record<string, string>;
    words: Set<string>;
}

/**
 * 从词表快照解析一个词形的学习状态。
 *
 * 与 `Word` 组件同一条链：先看词形自身，再看它的基础形态（如 `running → run`）。
 *
 * @param snapshot 词表快照。
 * @param word 原始词形。
 * @param lemma 后端给出的 lemma；缺失时退回原词形。
 * @returns 学习状态；不在词表中时为 undefined。
 */
export function resolveStatusFromSnapshot(
    snapshot: VocabularySnapshot,
    word: string,
    lemma?: string,
): WordStatus | undefined {
    const cleaned = (lemma ?? word).toLowerCase().trim();
    if (!cleaned) {
        return undefined;
    }
    const direct = snapshot.statuses[cleaned];
    if (direct) {
        return direct;
    }
    const base = snapshot.forms[cleaned] ?? (snapshot.words.has(cleaned) ? cleaned : undefined);
    return base ? snapshot.statuses[base] : undefined;
}

/**
 * 订阅词表快照。
 *
 * 只订阅三份数据本身，而不是 `version` 计数：`version` 在依赖数组里会被
 * `react-hooks/exhaustive-deps` 判为未使用，而这三份数据的引用变化恰好就是
 * 「词表真的变了」的充分条件。
 */
function useVocabularySnapshot(): VocabularySnapshot {
    return useVocabularyState(
        useShallow((state) => ({
            statuses: state.wordStatuses,
            forms: state.vocabularyForms,
            words: state.vocabularyWords,
        })),
    );
}

/**
 * 订阅一句的词汇标记统计。
 *
 * @param sentence 目标句。
 * @returns 两类标记的数量。
 */
export function useSentenceVocabularyCount(
    sentence: Sentence | null | undefined,
): SentenceVocabularyCount {
    const snapshot = useVocabularySnapshot();
    const guidance = useVocabularyGuidance();
    return useMemo(
        () =>
            countSentenceVocabulary(
                sentence,
                (word, lemma) => resolveStatusFromSnapshot(snapshot, word, lemma),
                guidance,
            ),
        [sentence, guidance, snapshot],
    );
}

/** 句子的稳定标识，与文稿滚动定位使用同一套键。 */
export const sentenceVocabularyKey = (sentence: Sentence): string =>
    `${sentence.fileHash}:${sentence.index}`;

/**
 * 批量统计整份文稿的标记数量。
 *
 * 一次算完整份列表再按句查表，避免每一行各自订阅词表、各自重算——
 * 长文稿有几百行，逐行订阅会在每次状态变更时触发几百次重渲染。
 *
 * @param sentences 文稿句子列表。
 * @returns 以 `fileHash:index` 为键的计数表。
 */
export function useTranscriptVocabularyCounts(
    sentences: Sentence[],
): Map<string, SentenceVocabularyCount> {
    const snapshot = useVocabularySnapshot();
    const guidance = useVocabularyGuidance();
    return useMemo(() => {
        const counts = new Map<string, SentenceVocabularyCount>();
        for (const sentence of sentences) {
            counts.set(
                sentenceVocabularyKey(sentence),
                countSentenceVocabulary(
                    sentence,
                    (word, lemma) => resolveStatusFromSnapshot(snapshot, word, lemma),
                    guidance,
                ),
            );
        }
        return counts;
    }, [sentences, guidance, snapshot]);
}
