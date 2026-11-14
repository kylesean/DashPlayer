import type { Sentence } from '@/common/types/SentenceC';
import type { SentencePracticeSummaryVO } from '@/common/contracts/sentence-practice';
import { cleanWord, isWordToken, splitWords } from '@/common/utils/subtitle/tokenize';
import { stripNonSpeechAnnotations } from '@/common/utils/practice/practiceTextClean';
import {
    groupSentencesIntoBlocks,
    type SentenceBlock,
} from '@/frontend/features/player/lib/sentence-grouping';
import type { SrtTender } from '@/frontend/features/player/lib/SrtTender';
import type { PracticeSentenceFilter } from './practiceStore';

/** 练习工坊中的一个可练习单元（单句或意群连读块）。 */
export interface PracticeUnit {
    /** 用于重置本地 UI 状态的稳定标识。 */
    key: string;
    /** 存储/检索练习记录的主锚点句（块内首句）。 */
    anchor: Sentence;
    fileHash: string;
    index: number;
    /** 用于比对与展示的完整英文原文（整句模式开启时已按块合并）。 */
    text: string;
    /** 合并后的中文源译文（若存在）。 */
    textZH: string;
    /** 音频播放边界 `[start, end]`（秒）。 */
    range: { start: number; end: number };
    /** 组成该单元的原始字幕行列表。 */
    sentences: Sentence[];
}

function buildUnitFromBlock(block: SentenceBlock, srtTender: SrtTender<Sentence> | null): PracticeUnit {
    const first = block.sentences[0] ?? block.repr;
    const range = srtTender
        ? block.sentences.reduce(
            (acc, s) => {
                const r = srtTender.mapSeekTime(s);
                return {
                    start: Math.min(acc.start, r.start),
                    end: Math.max(acc.end, r.end),
                };
            },
            { start: Number.POSITIVE_INFINITY, end: 0 },
        )
        : {
            start: first.adjustedStart ?? first.start,
            end: Math.max(...block.sentences.map((s) => s.adjustedEnd ?? s.end)),
        };

    const safeStart = Number.isFinite(range.start) ? range.start : 0;
    const safeEnd = Math.max(safeStart + 0.15, range.end);
    const text = stripNonSpeechAnnotations(
        block.sentences
            .map((s) => s.text.trim())
            .filter((s) => s.length > 0)
            .join(' '),
    );
    const textZH = block.sentences
        .map((s) => s.textZH?.trim() ?? '')
        .filter((s) => s.length > 0)
        .join(' ');

    return {
        key: block.repr.key,
        anchor: block.repr,
        fileHash: block.repr.fileHash,
        index: block.repr.index,
        text,
        textZH,
        range: { start: safeStart, end: safeEnd },
        sentences: block.sentences,
    };
}

function buildUnitFromSentence(sentence: Sentence, srtTender: SrtTender<Sentence> | null): PracticeUnit {
    const mapped = srtTender
        ? srtTender.mapSeekTime(sentence)
        : { start: sentence.adjustedStart ?? sentence.start, end: sentence.adjustedEnd ?? sentence.end };
    const safeStart = Math.max(0, mapped.start);
    const safeEnd = Math.max(safeStart + 0.15, mapped.end);
    return {
        key: sentence.key,
        anchor: sentence,
        fileHash: sentence.fileHash,
        index: sentence.index,
        text: stripNonSpeechAnnotations(sentence.text),
        textZH: sentence.textZH ?? '',
        range: { start: safeStart, end: safeEnd },
        sentences: [sentence],
    };
}

/**
 * 构建当前字幕集下的全量练习单元列表。
 *
 * 字幕在解析层已重切成完整意群，这里再按意群块归并一次是为了覆盖
 * 「字幕每行不足一句」的人工字幕：归并结果与主字幕区的导航单位保持一致。
 */
export function buildPracticeUnits(
    sentences: Sentence[],
    srtTender: SrtTender<Sentence> | null,
    fallbackCurrent?: Sentence | null,
): PracticeUnit[] {
    if (sentences.length === 0) {
        return fallbackCurrent ? [buildUnitFromSentence(fallbackCurrent, srtTender)] : [];
    }
    const ordered = [...sentences].sort((a, b) => a.index - b.index);
    const blocks = groupSentencesIntoBlocks(ordered);
    const units = blocks.length > 0
        ? blocks.map((block) => buildUnitFromBlock(block, srtTender))
        : ordered.map((sentence) => buildUnitFromSentence(sentence, srtTender));
    return units.filter((unit) => unit.text.length > 0);
}

/** 判断一个练习单元是否包含当前激活生词表中的词（优先使用后端 NLP blocks 的 lemma，回退词形查找）。 */
export function unitHasActiveVocab(
    unit: PracticeUnit,
    isVocabularyWord: (word: string) => boolean,
    getBaseWord: (word: string) => string | undefined,
): boolean {
    for (const sentence of unit.sentences) {
        const blocks = sentence.struct?.blocks;
        if (blocks && blocks.length > 0) {
            for (const block of blocks) {
                for (const part of block.blockParts) {
                    if (!part.isWord) continue;
                    const candidate = (part.lemma ?? part.content).toLowerCase().trim();
                    const base = getBaseWord(candidate) ?? candidate;
                    if (isVocabularyWord(base) || isVocabularyWord(candidate)) {
                        return true;
                    }
                }
            }
            continue;
        }
        for (const token of splitWords(sentence.text)) {
            if (!isWordToken(token)) continue;
            const cleaned = cleanWord(token);
            if (!cleaned) continue;
            const base = getBaseWord(cleaned) ?? cleaned;
            if (isVocabularyWord(base) || isVocabularyWord(cleaned)) {
                return true;
            }
        }
    }
    return false;
}

/** 低分门槛：< 80 分计入薄弱/待复盘队列（与 ScoreRing 绿环阈值对齐）。 */
export const PRACTICE_PASS_SCORE = 80;

/**
 * 按筛选条件过滤整集练习单元（用于顶部计数器与上下句智能连刷导航）。
 */
export function matchesPracticeFilter(
    unit: PracticeUnit,
    filter: PracticeSentenceFilter,
    summaryByIndex: ReadonlyMap<number, SentencePracticeSummaryVO>,
    vocabChecker: {
        isVocabularyWord: (word: string) => boolean;
        getBaseWord: (word: string) => string | undefined;
    },
): boolean {
    if (filter === 'all') return true;
    const summary = summaryByIndex.get(unit.index);
    if (filter === 'unpracticed') {
        return !summary;
    }
    if (filter === 'weak') {
        return summary !== undefined && summary.bestScore < PRACTICE_PASS_SCORE;
    }
    return unitHasActiveVocab(unit, vocabChecker.isVocabularyWord, vocabChecker.getBaseWord);
}
