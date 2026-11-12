import { describe, expect, it } from 'vitest';

import { buildMemoryMapLayout } from '@/common/learning/memoryMapLayout';
import type { MemoryMapTopicVO, MemoryMapWordVO } from '@/common/types/memoryMap';

const word = (
    name: string,
    overrides: Partial<MemoryMapWordVO> = {},
): MemoryMapWordVO => ({
    word: name,
    translate: null,
    status: 'learning',
    mastery: 0.3,
    encounters: 2,
    due: false,
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    context: null,
    ...overrides,
});

const topic = (
    key: string,
    words: MemoryMapWordVO[],
): MemoryMapTopicVO => ({
    key,
    label: `topic-${key}`,
    wordCount: words.length,
    counts: { learning: words.length, familiar: 0, known: 0, ignored: 0 },
    words,
});

describe('buildMemoryMapLayout', () => {
    it('同一份数据永远得到同一张图', () => {
        const topics = [topic('a', [word('alpha'), word('beta')])];
        expect(buildMemoryMapLayout(topics, null)).toEqual(buildMemoryMapLayout(topics, null));
    });

    it('坐标始终落在画布内', () => {
        const topics = Array.from({ length: 6 }, (_, index) => topic(`t${index}`, [
            word(`w${index}a`),
            word(`w${index}b`),
        ]));
        const { nodes } = buildMemoryMapLayout(topics, null);
        for (const node of nodes) {
            expect(node.x).toBeGreaterThanOrEqual(0);
            expect(node.x).toBeLessThanOrEqual(1);
            expect(node.y).toBeGreaterThanOrEqual(0);
            expect(node.y).toBeLessThanOrEqual(1);
        }
    });

    it('每个主题最多画 6 个词，避免图谱变成噪声', () => {
        const topics = [topic('big', Array.from({ length: 12 }, (_, i) => word(`w${i}`)))];
        const { nodes } = buildMemoryMapLayout(topics, null);
        expect(nodes).toHaveLength(6);
    });

    it('只画同主题内、共现至少两次的边，且无向边只画一次', () => {
        const topics = [topic('a', [
            word('alpha', { neighbors: [
                { word: 'beta', weight: 3 },
                { word: 'gamma', weight: 1 },
            ] }),
            word('beta', { neighbors: [{ word: 'alpha', weight: 3 }] }),
            word('gamma'),
        ])];
        const { edges } = buildMemoryMapLayout(topics, null);
        expect(edges).toHaveLength(1);
        expect(edges[0]).toMatchObject({ weight: 3 });
    });

    it('邻居不在同一主题时不连边', () => {
        const topics = [
            topic('a', [word('alpha', { neighbors: [{ word: 'beta', weight: 5 }] })]),
            topic('b', [word('beta')]),
        ];
        expect(buildMemoryMapLayout(topics, null).edges).toHaveLength(0);
    });

    it('没有上下文的词也进入图谱', () => {
        const loose = topic('loose', [word('orphan')]);
        const { nodes } = buildMemoryMapLayout([], loose);
        expect(nodes.map((node) => node.word)).toEqual(['orphan']);
    });

    it('遇见次数越多的词节点越大', () => {
        const topics = [topic('a', [
            word('often', { encounters: 10 }),
            word('rare', { encounters: 1 }),
        ])];
        const { nodes } = buildMemoryMapLayout(topics, null);
        const often = nodes.find((node) => node.word === 'often')!;
        const rare = nodes.find((node) => node.word === 'rare')!;
        expect(often.radius).toBeGreaterThan(rare.radius);
    });
});
