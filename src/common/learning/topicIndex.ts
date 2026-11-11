import { normalizeVector } from '@/common/learning/contentCompass';

/** 一条已向量化的主题样本。 */
export interface TopicVectorEntry {
    /** 稳定标识，通常是视频 id 或路径。 */
    id: string;
    /** 已归一化的向量。 */
    vector: number[];
}

/** 一次主题相似度检索结果。 */
export interface TopicMatch {
    id: string;
    /** 0-1 的余弦相似度。 */
    similarity: number;
}

/**
 * 把原始向量包装为索引条目。
 *
 * 入库前统一归一化，后续检索只需点积；不同来源的向量维度必须一致，
 * 维度不一致的条目会被调用方过滤，而不是在这里静默补齐。
 *
 * @param id 稳定标识。
 * @param vector 原始向量。
 * @returns 归一化后的索引条目。
 */
export const toTopicVectorEntry = (id: string, vector: readonly number[]): TopicVectorEntry => ({
    id,
    vector: normalizeVector(vector),
});

/**
 * 在内存主题索引里做余弦检索。
 *
 * 这是「本地向量索引」的最小实现：样本量是最近观看的个位数视频，
 * 线性扫描比引入 sqlite-vec 更简单，也不会给启动增加依赖。
 * 维度不一致的条目直接跳过，避免把不同模型的向量混算。
 *
 * @param query 查询向量。
 * @param entries 已归一化的索引条目。
 * @param limit 最多返回条数。
 * @returns 按相似度降序的匹配结果；没有可用条目时为空数组。
 */
export const searchTopicVectors = (
    query: readonly number[],
    entries: readonly TopicVectorEntry[],
    limit = entries.length,
): TopicMatch[] => {
    if (query.length === 0 || entries.length === 0 || limit <= 0) {
        return [];
    }
    const normalizedQuery = normalizeVector(query);
    const matches: TopicMatch[] = [];
    for (const entry of entries) {
        if (entry.vector.length !== normalizedQuery.length) {
            continue;
        }
        let dot = 0;
        for (let i = 0; i < normalizedQuery.length; i += 1) {
            dot += normalizedQuery[i] * entry.vector[i];
        }
        matches.push({
            id: entry.id,
            similarity: Math.max(0, Math.min(1, dot)),
        });
    }
    return matches
        .sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id))
        .slice(0, Math.max(0, limit));
};
