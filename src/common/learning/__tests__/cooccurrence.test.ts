import { describe, expect, it } from 'vitest';

import { buildCooccurrenceEdges } from '@/common/learning/memoryMap';

describe('buildCooccurrenceEdges', () => {
    it('同一句里的词两两形成共现边，且双向对称', () => {
        const edges = buildCooccurrenceEdges([
            { lemma: 'grasp', sentenceHash: 's1', topicKey: 'video:1' },
            { lemma: 'elusive', sentenceHash: 's1', topicKey: 'video:1' },
        ]);
        expect(edges.get('grasp')).toEqual([{ word: 'elusive', weight: 1 }]);
        expect(edges.get('elusive')).toEqual([{ word: 'grasp', weight: 1 }]);
    });

    it('同一句里重复出现不会自增权重', () => {
        const edges = buildCooccurrenceEdges([
            { lemma: 'grasp', sentenceHash: 's1', topicKey: 'video:1' },
            { lemma: 'grasp', sentenceHash: 's1', topicKey: 'video:1' },
            { lemma: 'elusive', sentenceHash: 's1', topicKey: 'video:1' },
        ]);
        expect(edges.get('grasp')).toEqual([{ word: 'elusive', weight: 1 }]);
    });

    it('跨句不产生共现边', () => {
        const edges = buildCooccurrenceEdges([
            { lemma: 'grasp', sentenceHash: 's1', topicKey: 'video:1' },
            { lemma: 'elusive', sentenceHash: 's2', topicKey: 'video:1' },
        ]);
        expect(edges.size).toBe(0);
    });

    it('同一句但不同主题不产生共现边', () => {
        const edges = buildCooccurrenceEdges([
            { lemma: 'grasp', sentenceHash: 's1', topicKey: 'video:1' },
            { lemma: 'elusive', sentenceHash: 's1', topicKey: 'video:2' },
        ]);
        expect(edges.size).toBe(0);
    });

    it('没有句子哈希的遭遇不参与共现', () => {
        const edges = buildCooccurrenceEdges([
            { lemma: 'grasp', sentenceHash: null, topicKey: 'video:1' },
            { lemma: 'elusive', sentenceHash: null, topicKey: 'video:1' },
        ]);
        expect(edges.size).toBe(0);
    });

    it('权重按共同出现的句子数累加，并按权重降序', () => {
        const edges = buildCooccurrenceEdges([
            { lemma: 'a', sentenceHash: 's1', topicKey: 't' },
            { lemma: 'b', sentenceHash: 's1', topicKey: 't' },
            { lemma: 'c', sentenceHash: 's1', topicKey: 't' },
            { lemma: 'a', sentenceHash: 's2', topicKey: 't' },
            { lemma: 'b', sentenceHash: 's2', topicKey: 't' },
            { lemma: 'a', sentenceHash: 's3', topicKey: 't' },
            { lemma: 'c', sentenceHash: 's3', topicKey: 't' },
        ]);
        expect(edges.get('a')).toEqual([
            { word: 'b', weight: 2 },
            { word: 'c', weight: 2 },
        ]);
    });

    it('每个词最多保留指定数量的边', () => {
        const edges = buildCooccurrenceEdges([
            { lemma: 'a', sentenceHash: 's1', topicKey: 't' },
            { lemma: 'b', sentenceHash: 's1', topicKey: 't' },
            { lemma: 'c', sentenceHash: 's1', topicKey: 't' },
            { lemma: 'd', sentenceHash: 's1', topicKey: 't' },
        ], 2);
        expect(edges.get('a')).toHaveLength(2);
    });
});
