/**
 * 高频功能词与代词。
 *
 * 它们不参与内容词统计，也不应占用学习建议或理解度估算的权重。
 */
export const CONTENT_STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'from',
    'with', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does',
    'did', 'have', 'has', 'had', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you',
    'he', 'she', 'we', 'they', 'them', 'his', 'her', 'their', 'our', 'my', 'your', 'not', 'no',
    'so', 'than', 'then', 'there', 'here', 'when', 'where', 'why', 'how', 'what', 'which',
    'who', 'whom', 'would', 'could', 'should', 'will', 'can', 'may', 'might', 'must', 'just',
    'very', 'too', 'also', 'about', 'into', 'over', 'after', 'before', 'up', 'down', 'out',
    'off', 'again', 'all', 'any', 'some', 'more', 'most', 'other', 'such', 'only', 'own',
    'same', 'both', 'each', 'few', 'many', 'much', 'one', 'two', 'get', 'got', 'make', 'made',
]);

/**
 * 判断一个 lemma 是否应作为内容词参与学习计算。
 *
 * @param lemma 归一化后的词。
 * @returns 非停用词、非数字且长度有效时为 true。
 */
export const isContentLemma = (lemma: string): boolean => {
    const normalized = lemma.trim().toLowerCase();
    return normalized.length > 1
        && !CONTENT_STOP_WORDS.has(normalized)
        && !/^\d+$/.test(normalized);
};
