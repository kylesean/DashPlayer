import { describe, expect, it, vi } from 'vitest';

import { WordEncounterServiceImpl } from '@/backend/services/WordEncounterService';
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
});
