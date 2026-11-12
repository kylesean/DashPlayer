import { describe, expect, it } from 'vitest';

import {
    buildLearningMetrics,
    countRecalledWords,
    feedbackRate,
    practiceCoverage,
    reviewCompletionRate,
} from '@/common/learning/learningMetrics';
import type { MetricEncounter } from '@/common/learning/learningMetrics';
import type { WordStatus } from '@/common/types/vocabulary';

const encounter = (
    lemma: string,
    action: string,
    createdAt = '2026-11-10T00:00:00.000Z',
): MetricEncounter => ({ lemma, action, created_at: createdAt });

const activeWord = (word: string, status: WordStatus = 'learning') => ({ word, status });

describe('countRecalledWords', () => {
    it('按 lemma 去重，同一个词复习多次只算一个', () => {
        expect(countRecalledWords([
            { lemma: 'Serendipity', rating: 'good' },
            { lemma: 'serendipity', rating: 'easy' },
            { lemma: 'grasp', rating: 'good' },
        ])).toBe(2);
    });

    it('again / hard 不算成功回忆', () => {
        expect(countRecalledWords([
            { lemma: 'grasp', rating: 'again' },
            { lemma: 'grasp', rating: 'hard' },
        ])).toBe(0);
    });

    it('没有评级的事件不计入', () => {
        expect(countRecalledWords([{ lemma: 'grasp', rating: null }])).toBe(0);
    });

    it('空窗口返回 0 而不是 NaN', () => {
        expect(countRecalledWords([])).toBe(0);
    });
});

describe('reviewCompletionRate', () => {
    it('复习次数与到期积压共同构成分母', () => {
        expect(reviewCompletionRate(6, 4)).toBeCloseTo(0.6);
    });

    it('完全没有任何样本时为 null，而不是 0', () => {
        expect(reviewCompletionRate(0, 0)).toBeNull();
    });

    it('全部到期未处理时为 0', () => {
        expect(reviewCompletionRate(0, 5)).toBe(0);
    });
});

describe('feedbackRate', () => {
    it('只统计活跃词的明确反馈', () => {
        const events = [
            encounter('grasp', 'known'),
            encounter('elusive', 'ignore'),
            encounter('grasp', 'hover'),
        ];
        expect(feedbackRate(events, [
            activeWord('grasp'),
            activeWord('elusive'),
            activeWord('third'),
            activeWord('fourth'),
        ])).toBeCloseTo(0.5);
    });

    it('不在活跃词表里的反馈不计入分子', () => {
        const events = [encounter('retired', 'known')];
        expect(feedbackRate(events, [activeWord('grasp')])).toBe(0);
    });

    it('没有活跃词时为 null', () => {
        expect(feedbackRate([encounter('grasp', 'known')], [])).toBeNull();
    });
});

describe('practiceCoverage', () => {
    it('跟读 / 听写 / 复习都算练习覆盖', () => {
        const events = [
            encounter('grasp', 'shadow'),
            encounter('elusive', 'dictation'),
            encounter('third', 'review'),
            encounter('fourth', 'open'),
        ];
        expect(practiceCoverage(events, [
            activeWord('grasp'),
            activeWord('elusive'),
            activeWord('third'),
            activeWord('fourth'),
        ])).toBeCloseTo(0.75);
    });

    it('打开词卡不算练习', () => {
        expect(practiceCoverage([encounter('grasp', 'open')], [activeWord('grasp')])).toBe(0);
    });
});

describe('buildLearningMetrics', () => {
    const base = {
        windowDays: 7,
        reviewEvents: [
            { lemma: 'grasp', rating: 'good' as const },
            { lemma: 'grasp', rating: 'good' as const },
            { lemma: 'elusive', rating: 'again' as const },
        ],
        encounters: [
            encounter('grasp', 'shadow'),
            encounter('elusive', 'known'),
        ],
        activeWords: [activeWord('grasp'), activeWord('elusive')],
        dueBacklog: 2,
        recommendationShown: 10,
        recommendationOpened: 3,
        retention7: 0.5,
        retention30: 0.4,
        retention7Reviewed: 4,
        retention30Reviewed: 10,
    };

    it('北极星指标是去重后的成功回忆词数', () => {
        const result = buildLearningMetrics(base);
        expect(result.northStar.key).toBe('weeklyRecallWords');
        expect(result.northStar.value).toBe(1);
    });

    it('辅助指标顺序固定且覆盖全部可计算项', () => {
        const result = buildLearningMetrics(base);
        expect(result.metrics.map((metric) => metric.key)).toEqual([
            'retention7',
            'retention30',
            'reviewCompletion',
            'recommendationOpen',
            'feedbackRate',
            'dueBacklog',
            'practiceCoverage',
        ]);
    });

    it('缺数据源的指标被显式标注为不可用', () => {
        const result = buildLearningMetrics(base);
        expect(result.unavailable).toEqual([
            'interventionsPerTenMinutes',
            'continueAfterSession',
        ]);
        const keys = result.metrics.map((metric) => metric.key);
        expect(keys).not.toContain('interventionsPerTenMinutes');
        expect(keys).not.toContain('continueAfterSession');
    });

    it('推荐打开率用去重后的曝光作为分母', () => {
        const result = buildLearningMetrics(base);
        const openMetric = result.metrics.find((metric) => metric.key === 'recommendationOpen');
        expect(openMetric?.value).toBeCloseTo(0.3);
        expect(openMetric?.denominator).toBe(10);
    });

    it('全空输入不会产生 NaN 或 Infinity', () => {
        const result = buildLearningMetrics({
            ...base,
            reviewEvents: [],
            encounters: [],
            activeWords: [],
            dueBacklog: 0,
            recommendationShown: 0,
            recommendationOpened: 0,
            retention7: null,
            retention30: null,
            retention7Reviewed: 0,
            retention30Reviewed: 0,
        });
        expect(result.northStar.value).toBe(0);
        for (const metric of result.metrics) {
            expect(Number.isFinite(metric.value as number) || metric.value === null).toBe(true);
        }
    });
});
