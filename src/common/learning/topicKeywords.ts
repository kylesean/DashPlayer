import { isContentLemma } from '@/common/learning/contentWords';

/** 一个主题的语境文本集合。 */
export interface TopicKeywordInput {
    /** 稳定主题键。 */
    key: string;
    /** 该主题下真实出现过的句子；同一句可重复，按出现次数计。 */
    texts: string[];
}

/** 每个主题最多给出的关键词数。 */
export const MAX_TOPIC_KEYWORDS = 3;
/** 一个词至少要在本主题的多少句里出现，才可能成为关键词。 */
const MIN_TOPIC_DOCUMENTS = 2;

/**
 * 把句子切成用于统计的内容词。
 *
 * 只做正则切分与停用词过滤，不引入分词器：关键词是给人看的线索，
 * 不是要精确到词性的语言学标注。
 *
 * @param text 句子原文。
 * @returns 去重后的小写内容词。
 */
export const extractKeywordTerms = (text: string): string[] => {
    const seen = new Set<string>();
    for (const raw of text.toLowerCase().replace(/[^a-z'\s-]/gu, ' ').split(/\s+/u)) {
        const term = raw.replace(/^[-']+|[-']+$/gu, '');
        if (term && isContentLemma(term)) {
            seen.add(term);
        }
    }
    return Array.from(seen);
};

/**
 * 为每个主题挑出「在本主题常见、在其它主题少见」的关键词。
 *
 * 用 TF-IDF 而不是纯词频：纯词频会选出 "guy / thing / really" 这类到处都有的词，
 * 它们不能说明这组词为什么被放在一起。IDF 部分让「只有这个主题才反复出现」
 * 的词浮上来，这正是聚类命名需要的区分度。
 *
 * 结果完全确定：同分按词面升序，同一份数据永远得到同一组关键词。
 *
 * @param inputs 各主题的语境文本。
 * @returns 主题键到关键词列表的映射；没有足够证据的主题不在结果里。
 */
export const extractTopicKeywords = (
    inputs: TopicKeywordInput[],
): Map<string, string[]> => {
    const usable = inputs.filter((input) => input.texts.length > 0);
    if (usable.length === 0) {
        return new Map();
    }

    // 每个主题：词 -> 出现在多少句里。
    const perTopic = usable.map((input) => {
        const counts = new Map<string, number>();
        for (const text of input.texts) {
            for (const term of extractKeywordTerms(text)) {
                counts.set(term, (counts.get(term) ?? 0) + 1);
            }
        }
        return { key: input.key, counts, total: input.texts.length };
    });

    // 每个词出现在多少个不同主题里，用于 IDF。
    const topicFrequency = new Map<string, number>();
    for (const topic of perTopic) {
        for (const term of topic.counts.keys()) {
            topicFrequency.set(term, (topicFrequency.get(term) ?? 0) + 1);
        }
    }

    const result = new Map<string, string[]>();
    for (const topic of perTopic) {
        const scored: Array<{ term: string; score: number }> = [];
        for (const [term, count] of topic.counts) {
            if (count < MIN_TOPIC_DOCUMENTS) {
                continue;
            }
            const tf = count / topic.total;
            const df = topicFrequency.get(term) ?? 1;
            // 出现在每个主题里的词没有区分度：它的 IDF 为 0，
            // 留下来只会把「这组词为什么在一起」说成「这组词里有个常见词」。
            if (usable.length > 1 && df >= usable.length) {
                continue;
            }
            const idf = Math.log(usable.length / df) + 1;
            scored.push({ term, score: tf * idf });
        }
        if (scored.length === 0) {
            continue;
        }
        scored.sort((left, right) => (
            right.score - left.score || left.term.localeCompare(right.term)
        ));
        result.set(topic.key, scored.slice(0, MAX_TOPIC_KEYWORDS).map((item) => item.term));
    }
    return result;
};
