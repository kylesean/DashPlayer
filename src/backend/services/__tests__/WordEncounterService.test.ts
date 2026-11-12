import { describe, expect, it, vi } from 'vitest';

import { WordEncounterServiceImpl } from '@/backend/services/WordEncounterService';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import type WordEncounterRepository from '@/backend/services/repositories/WordEncounterRepository';
import type WordsRepository from '@/backend/services/repositories/WordsRepository';

describe('WordEncounterService', () => {
    it('把句中词形归一化为 lemma 后记录上下文', async () => {
        const record = vi.fn(async () => undefined);
        const service = new WordEncounterServiceImpl(
            { record } as unknown as WordEncounterRepository,
            { findByWord: async () => null } as unknown as WordsRepository,
            {} as unknown as ReviewCardRepository,
        );

        await service.record({
            word: 'Running',
            action: 'open',
            videoId: 'video-1',
            fileHash: 'subtitle-1',
            sentenceIndex: 3,
            sentenceHash: 'sentence-3',
            context: 'Running keeps me healthy.',
        });

        expect(record).toHaveBeenCalledWith(expect.objectContaining({
            word: 'Running',
            lemma: 'run',
            action: 'open',
            video_id: 'video-1',
            file_hash: 'subtitle-1',
            sentence_index: 3,
            sentence_hash: 'sentence-3',
        }));
    });

    it('空词不写事件', async () => {
        const record = vi.fn(async () => undefined);
        const service = new WordEncounterServiceImpl(
            { record } as unknown as WordEncounterRepository,
            { findByWord: async () => null } as unknown as WordsRepository,
            {} as unknown as ReviewCardRepository,
        );

        await service.record({ word: '   ', action: 'open' });

        expect(record).not.toHaveBeenCalled();
    });

    it('产出型练习的 0–100 分数只归一化一次，不会把熟悉词降级', async () => {
        const record = vi.fn(async () => undefined);
        const updateLearning = vi.fn(async (
            _lemma: string,
            patch: { mastery: number; confidence: number; status: string; lastSeenAt: string },
        ) => patch);
        const existing = {
            word: 'grasp',
            lemma: 'grasp',
            status: 'familiar',
            source: 'manual',
            mastery: 0.6,
            confidence: 0.4,
        } as unknown as Word;
        const service = new WordEncounterServiceImpl(
            { record } as unknown as WordEncounterRepository,
            {
                findByWord: async () => existing,
                updateLearning,
            } as unknown as WordsRepository,
            {} as unknown as ReviewCardRepository,
        );

        await service.recordProductionEvidence({ words: ['grasp'], score: 90, action: 'retell' });

        const [, patch] = updateLearning.mock.calls[0];
        expect(patch.mastery).toBeCloseTo(0.672, 6);
        expect(patch.status).toBe('familiar');
        expect(record).toHaveBeenCalledWith(expect.objectContaining({
            lemma: 'grasp',
            action: 'retell',
            score: 90,
        }));
    });
});
