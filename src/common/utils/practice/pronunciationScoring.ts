import type { SentencePracticeWordResult } from '@/common/contracts/sentence-practice';
import { cleanWord, isWordToken, splitWords } from '@/common/utils/subtitle/tokenize';
import { stripNonSpeechAnnotations } from '@/common/utils/practice/practiceTextClean';

/**
 * 词级对齐评分:把用户产出(跟读的 ASR 转写、或听写输入)与原句做加权编辑距离
 * 对齐,产出逐词反馈与 0-100 分数。跟读与听写共用同一条确定性路径,不经 LLM,
 * 保证打分稳定可单测。
 *
 * 评分公式:(match 数 + Σ 0.5×相似度(sub)) / 期望词数 × 100。
 * 替换词按字符相似度折算贡献——听岔一个音的 sub 拿回一半分,完全说错的词几乎不拿分。
 */

/** sub 状态对分数的最大贡献权重。 */
const SUB_WEIGHT = 0.5;

/**
 * 练习对齐结果:分数与逐词反馈。
 */
export interface PracticeAlignment {
    score: number;
    words: SentencePracticeWordResult[];
}

/**
 * 经典滚动数组编辑距离(字符级,仅用于词对相似度)。
 */
const levenshteinDistance = (a: string, b: string): number => {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
        }
        previous = current;
    }
    return previous[b.length];
};

/**
 * 0-1 词对相似度:1 - 编辑距离 / 较长词长。
 */
const charSimilarity = (a: string, b: string): number => {
    if (a === b) return 1;
    const longer = Math.max(a.length, b.length);
    if (longer === 0) return 1;
    return 1 - levenshteinDistance(a, b) / longer;
};

/**
 * 规范化文本为比对词序列:统一分词、只留词 token、小写去标点。
 * 跟读转写与听写输入两侧使用同一套规范化,缩读 it's 等形态天然对齐。
 *
 * 额外剔除不含字母/数字/中文的 token:字幕里空格包围的孤立连字符
 * （"oh - really" 的破折号）会通过 isWordToken，但 ASR 与听写输入都
 * 不可能产出它,留在期望序列里只会虚增分母造成固定扣分。
 */
export const normalizePracticeTokens = (text: string): string[] =>
    splitWords(stripNonSpeechAnnotations(text))
        .filter(isWordToken)
        .map(cleanWord)
        .filter((word) => word.length > 0)
        .filter((word) => /[\p{L}\p{N}]/u.test(word));

/**
 * 词级加权编辑距离对齐。替换代价取 1 - 词对相似度,使"听岔的音"
 * 倾向于对到对应目标词而不是拆成 missing+extra。
 *
 * @param expectedText 原句文本。
 * @param actualText 用户产出文本。
 * @returns 分数与按原句词序排列的逐词结果(extra 词追加在末尾)。
 */
export const alignPracticeTokens = (expectedText: string, actualText: string): PracticeAlignment => {
    const expected = normalizePracticeTokens(expectedText);
    const actual = normalizePracticeTokens(actualText);
    if (expected.length === 0) {
        return {
            score: actual.length === 0 ? 100 : 0,
            words: actual.map((word) => ({ expected: '', heard: word, status: 'extra' as const })),
        };
    }
    if (actual.length === 0) {
        return {
            score: 0,
            words: expected.map((word) => ({ expected: word, heard: null, status: 'missing' as const })),
        };
    }

    // dp[i][j] = 对齐 expected 前 i 词与 actual 前 j 词的最小总代价
    // match 0;sub = 1 - 相似度;missing/extra 各记 1。
    const n = expected.length;
    const m = actual.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = 1; i <= n; i++) dp[i][0] = i;
    for (let j = 1; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const pairCost = 1 - charSimilarity(expected[i - 1], actual[j - 1]);
            dp[i][j] = Math.min(
                dp[i - 1][j - 1] + pairCost,
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
            );
        }
    }

    // 从 (n, m) 回溯:对角线为配对(match/sub),向上为期望词缺失,向左为多余词。
    const raw: SentencePracticeWordResult[] = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0) {
            const pairCost = 1 - charSimilarity(expected[i - 1], actual[j - 1]);
            if (dp[i][j] === dp[i - 1][j - 1] + pairCost) {
                if (expected[i - 1] === actual[j - 1]) {
                    raw.push({ expected: expected[i - 1], heard: actual[j - 1], status: 'match' });
                } else {
                    raw.push({
                        expected: expected[i - 1],
                        heard: actual[j - 1],
                        status: 'sub',
                        similarity: Number(charSimilarity(expected[i - 1], actual[j - 1]).toFixed(2)),
                    });
                }
                i -= 1;
                j -= 1;
                continue;
            }
        }
        if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
            raw.push({ expected: expected[i - 1], heard: null, status: 'missing' });
            i -= 1;
            continue;
        }
        raw.push({ expected: '', heard: actual[j - 1], status: 'extra' });
        j -= 1;
    }
    raw.reverse();

    const aligned = raw.filter((entry) => entry.status !== 'extra');
    const matched = aligned.filter((entry) => entry.status === 'match').length;
    const subSimilaritySum = aligned
        .filter((entry) => entry.status === 'sub')
        .reduce((sum, entry) => sum + (entry.similarity ?? 0), 0);
    const score = Math.round(
        Math.max(0, Math.min(100, ((matched + SUB_WEIGHT * subSimilaritySum) / n) * 100)),
    );
    return { score, words: raw };
};
