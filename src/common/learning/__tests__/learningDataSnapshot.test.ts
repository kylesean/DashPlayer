import { describe, expect, it } from 'vitest';

import {
    LearningDataSnapshotError,
    parseLearningDataExport,
} from '@/common/learning/learningDataSnapshot';

const NOW = '2026-01-01T00:00:00.000Z';

const validWord = {
    word: 'journey',
    translate: '旅程',
    status: 'learning',
    source: 'manual',
    mastery: 0.4,
    confidence: 0.5,
    lastSeenAt: null,
    masteredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
};

const baseSnapshot = {
    schemaVersion: 2,
    exportedAt: NOW,
    words: [validWord],
    encounters: [],
    reviewCards: [],
    recommendations: [],
    sentencePractices: [],
    productionPractices: [],
};

describe('parseLearningDataExport', () => {
    it('解析完整备份并把掌握度截断到 0–1', () => {
        const snapshot = parseLearningDataExport({
            ...baseSnapshot,
            words: [{ ...validWord, mastery: 1.7, confidence: -0.3 }],
        });

        expect(snapshot.words).toHaveLength(1);
        expect(snapshot.words[0]).toMatchObject({ mastery: 1, confidence: 0 });
    });

    it('兼容 schemaVersion 1：缺失的练习记录按空数组处理', () => {
        const { sentencePractices, productionPractices, ...v1 } = baseSnapshot;
        void sentencePractices;
        void productionPractices;

        const snapshot = parseLearningDataExport({ ...v1, schemaVersion: 1 });

        expect(snapshot.sentencePractices).toEqual([]);
        expect(snapshot.productionPractices).toEqual([]);
    });

    it('拒绝高于当前支持的版本', () => {
        expect(() => parseLearningDataExport({ ...baseSnapshot, schemaVersion: 3 }))
            .toThrow(LearningDataSnapshotError);
    });

    it('拒绝重复词条与重复复习卡', () => {
        expect(() => parseLearningDataExport({
            ...baseSnapshot,
            words: [validWord, { ...validWord, word: 'JOURNEY' }],
        })).toThrow('重复词条');

        const card = {
            word: 'journey',
            dueAt: NOW,
            state: 'new',
            reps: 0,
            lapses: 0,
            stability: 0,
            difficulty: 0,
            lastReviewAt: null,
            lastRating: null,
            createdAt: NOW,
            updatedAt: NOW,
        };
        expect(() => parseLearningDataExport({
            ...baseSnapshot,
            reviewCards: [card, card],
        })).toThrow('重复复习卡');
    });

    it('指出具体非法字段而不是抛裸异常', () => {
        expect(() => parseLearningDataExport({
            ...baseSnapshot,
            words: [{ ...validWord, status: 'mastered' }],
        })).toThrow('$.words[0].status');

        expect(() => parseLearningDataExport({
            ...baseSnapshot,
            words: [{ ...validWord, word: '' }],
        })).toThrow('$.words[0].word');
    });

    it('非对象根节点直接拒绝', () => {
        expect(() => parseLearningDataExport(null)).toThrow(LearningDataSnapshotError);
        expect(() => parseLearningDataExport([])).toThrow(LearningDataSnapshotError);
    });

    it('复习卡调度字段按边界截断，畸形巨值不会让复习调度崩溃', () => {
        const card = {
            word: 'journey',
            dueAt: NOW,
            state: 'review',
            reps: -3,
            lapses: 5,
            stability: 1e308,
            difficulty: 42,
            lastReviewAt: NOW,
            lastRating: 'good',
            createdAt: NOW,
            updatedAt: NOW,
        };

        const snapshot = parseLearningDataExport({ ...baseSnapshot, reviewCards: [card] });

        // stability 1e308 会在调度处变成 new Date(Infinity) 抛 RangeError；
        // 与 mastery/confidence 同口径截断，而不是拒绝整份备份。
        expect(snapshot.reviewCards[0].stability).toBe(36_500);
        expect(snapshot.reviewCards[0].difficulty).toBe(10);
        expect(snapshot.reviewCards[0].reps).toBe(0);
        expect(snapshot.reviewCards[0].lapses).toBe(5);
    });

    it('拒绝不可解析的时间字符串', () => {
        expect(() => parseLearningDataExport({
            ...baseSnapshot,
            words: [{ ...validWord, lastSeenAt: 'haha' }],
        })).toThrow('$.words[0].lastSeenAt');

        expect(() => parseLearningDataExport({
            ...baseSnapshot,
            reviewCards: [{
                word: 'journey', dueAt: '明天', state: 'new', reps: 0, lapses: 0,
                stability: 0, difficulty: 0, lastReviewAt: null, lastRating: null,
                createdAt: NOW, updatedAt: NOW,
            }],
        })).toThrow('$.reviewCards[0].dueAt');
    });

    it('恢复的用户词不携带 default 内置标记，重映射为 manual', () => {
        const snapshot = parseLearningDataExport({
            ...baseSnapshot,
            words: [{ ...validWord, source: 'default' }],
        });

        // 'default' 标记的词会被 listUserWords / 导出 / 会话摘要全部排除，
        // 成为恢复成功却永远不可见、下次导出静默丢失的幽灵词。
        expect(snapshot.words[0].source).toBe('manual');
    });
});
