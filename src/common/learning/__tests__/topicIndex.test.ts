import { describe, expect, it } from 'vitest';

import {
    searchTopicVectors,
    toTopicVectorEntry,
} from '@/common/learning/topicIndex';

describe('topic vector index', () => {
    it('检索按余弦相似度降序返回', () => {
        const entries = [
            toTopicVectorEntry('orthogonal', [0, 1]),
            toTopicVectorEntry('same', [1, 0]),
            toTopicVectorEntry('close', [1, 0.2]),
        ];

        const matches = searchTopicVectors([1, 0], entries);

        expect(matches.map((match) => match.id)).toEqual(['same', 'close', 'orthogonal']);
        expect(matches[0].similarity).toBeCloseTo(1, 10);
    });

    it('维度不一致的条目被跳过，不会混算', () => {
        const entries = [
            toTopicVectorEntry('two-dim', [1, 0]),
            toTopicVectorEntry('three-dim', [1, 0, 0]),
        ];

        expect(searchTopicVectors([1, 0], entries).map((match) => match.id)).toEqual(['two-dim']);
    });

    it('零向量与空索引返回空结果', () => {
        expect(searchTopicVectors([], [toTopicVectorEntry('a', [1, 0])])).toEqual([]);
        expect(searchTopicVectors([1, 0], [])).toEqual([]);
        expect(searchTopicVectors([0, 0], [toTopicVectorEntry('a', [1, 0])])[0].similarity).toBe(0);
    });

    it('limit 限制返回条数', () => {
        const entries = [
            toTopicVectorEntry('a', [1, 0]),
            toTopicVectorEntry('b', [0.9, 0.1]),
            toTopicVectorEntry('c', [0.5, 0.5]),
        ];

        expect(searchTopicVectors([1, 0], entries, 2)).toHaveLength(2);
        expect(searchTopicVectors([1, 0], entries, 0)).toEqual([]);
    });
});
