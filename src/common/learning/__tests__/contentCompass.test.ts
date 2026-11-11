import { describe, expect, it } from 'vitest';

import {
    aggregateInterestScore,
    lexicalSimilarity,
    normalizeVector,
    rankContentCompassCandidates,
    type ContentCompassRankCandidate,
} from '@/common/learning/contentCompass';

const candidate = (
    id: string,
    override: Partial<ContentCompassRankCandidate> = {},
): ContentCompassRankCandidate => ({
    id,
    directoryKey: `/library/${id}`,
    comprehensionScore: 0.78,
    interestScore: 0,
    dueWords: [],
    learningWords: [],
    ...override,
});

describe('content compass ranking', () => {
    it('归一化后向量长度为 1，零向量保持为零', () => {
        const normalized = normalizeVector([3, 4]);
        expect(normalized[0]).toBeCloseTo(0.6, 10);
        expect(normalized[1]).toBeCloseTo(0.8, 10);
        expect(normalizeVector([0, 0])).toEqual([0, 0]);
    });

    it('兴趣分取近期视频相似度均值，避免单部视频主导', () => {
        expect(aggregateInterestScore([])).toBe(0);
        expect(aggregateInterestScore([1, 0])).toBeCloseTo(0.5, 10);
        expect(aggregateInterestScore([0.9, 1.2, -0.2])).toBeCloseTo(0.6333, 4);
    });

    it('计算归一化词频向量的余弦相似度', () => {
        expect(lexicalSimilarity(
            new Map([['journey', 0.5], ['road', 0.5]]),
            new Map([['journey', 0.5], ['road', 0.5]]),
        )).toBeCloseTo(1, 10);
        expect(lexicalSimilarity(
            new Map([['journey', 1]]),
            new Map([['orbit', 1]]),
        )).toBe(0);
    });

    it('到期词复现优先于普通主题相似', () => {
        const ranked = rankContentCompassCandidates([
            candidate('interest', { directoryKey: '/a', interestScore: 0.9 }),
            candidate('due', { directoryKey: '/b', dueWords: ['journey', 'resilient'] }),
        ]);

        expect(ranked[0].id).toBe('due');
        expect(ranked[0].reason).toBe('due_review');
        expect(ranked[1].reason).toBe('interest_match');
    });

    it('同目录只占一个首发名额，先保证来源多样', () => {
        const ranked = rankContentCompassCandidates([
            candidate('same-a', { directoryKey: '/same', dueWords: ['a', 'b', 'c'] }),
            candidate('same-b', { directoryKey: '/same', dueWords: ['a', 'b'] }),
            candidate('other', { directoryKey: '/other', learningWords: ['journey'] }),
        ]);

        expect(ranked.map((item) => item.id)).toEqual(['same-a', 'other', 'same-b']);
    });

    it('过难内容会被降权，但不会从候选里消失', () => {
        const ranked = rankContentCompassCandidates([
            candidate('too-hard', { comprehensionScore: 0.1, dueWords: ['a'] }),
            candidate('fit', { comprehensionScore: 0.8 }),
        ]);

        expect(ranked[0].id).toBe('fit');
        expect(ranked.map((item) => item.id)).toContain('too-hard');
    });
});
