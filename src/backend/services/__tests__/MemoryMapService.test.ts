import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryMapServiceImpl } from '@/backend/services/MemoryMapService';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type WatchHistoryRepository from '@/backend/services/repositories/WatchHistoryRepository';
import type { Word } from '@/backend/infrastructure/db/tables/words';
import type { WordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import type { ReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';

const NOW = Date.now();

const word = (value: Partial<Word> & Pick<Word, 'word'>): Word => ({
    id: 1,
    stem: null,
    translate: null,
    note: null,
    status: 'learning',
    source: 'manual',
    mastery: 0.3,
    confidence: 0.4,
    last_seen_at: '2026-01-01T10:00:00.000Z',
    mastered_at: null,
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
    ...value,
});

const encounter = (args: {
    lemma: string;
    action?: WordEncounter['action'];
    videoId?: string | null;
    fileHash?: string | null;
    context?: string | null;
    createdAt?: string;
}): WordEncounter => ({
    id: 1,
    word: args.lemma,
    lemma: args.lemma,
    action: args.action ?? 'open',
    video_id: args.videoId ?? null,
    file_hash: args.fileHash ?? null,
    sentence_index: 0,
    sentence_hash: null,
    context: args.context ?? null,
    score: null,
    rating: null,
    created_at: args.createdAt ?? '2026-01-01T10:00:00.000Z',
});

const card = (value: string, dueAt: string): ReviewCard => ({
    id: 1,
    word: value,
    due_at: dueAt,
    state: 'review',
    reps: 1,
    lapses: 0,
    stability: 1,
    difficulty: 5,
    last_review_at: null,
    last_rating: null,
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
});

const buildService = (args: {
    words: Word[];
    encounters: WordEncounter[];
    cards?: ReviewCard[];
    records?: Array<{ id: string; file_name: string }>;
}) => {
    const learningDataRepository = {
        listUserWords: vi.fn().mockResolvedValue(args.words),
        listEncounters: vi.fn().mockResolvedValue(args.encounters),
        listReviewCards: vi.fn().mockResolvedValue(args.cards ?? []),
    } as unknown as LearningDataRepository;
    const watchHistoryRepository = {
        listByProjectType: vi.fn().mockResolvedValue(args.records ?? []),
    } as unknown as WatchHistoryRepository;
    return new MemoryMapServiceImpl(learningDataRepository, watchHistoryRepository);
};

describe('MemoryMapService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('按视频聚合词，并统计记忆阶段', async () => {
        const service = buildService({
            words: [
                word({ word: 'journey', status: 'learning', translate: '旅程' }),
                word({ word: 'orbit', status: 'known', mastery: 1 }),
            ],
            encounters: [
                encounter({ lemma: 'journey', videoId: 'video-1', context: 'It was a long journey home.' }),
                encounter({ lemma: 'orbit', videoId: 'video-1', context: 'The satellite stayed in orbit.' }),
                encounter({ lemma: 'journey', videoId: 'video-1', context: 'The journey took all day.', createdAt: '2026-01-01T11:00:00.000Z' }),
            ],
            records: [{ id: 'video-1', file_name: 'A Long Journey.mkv' }],
        });

        const map = await service.getMap({ limit: 8 });

        expect(map.totalWords).toBe(2);
        expect(map.activeWords).toBe(1);
        expect(map.topics).toHaveLength(1);
        expect(map.topics[0]).toMatchObject({
            key: 'video:video-1',
            label: 'A Long Journey',
            wordCount: 2,
        });
        expect(map.topics[0].counts).toEqual({ learning: 1, familiar: 0, known: 1, ignored: 0 });
        const journey = map.topics[0].words.find((item) => item.word === 'journey');
        expect(journey?.encounters).toBe(2);
        expect(journey?.context).toBe('The journey took all day.');
    });

    it('到期词排在主题内最前面，并标记 due', async () => {
        const service = buildService({
            words: [
                word({ word: 'journey', status: 'learning' }),
                word({ word: 'orbit', status: 'familiar' }),
            ],
            encounters: [
                encounter({ lemma: 'journey', videoId: 'video-1' }),
                encounter({ lemma: 'orbit', videoId: 'video-1' }),
            ],
            cards: [card('orbit', new Date(NOW - 60_000).toISOString())],
            records: [{ id: 'video-1', file_name: 'space.mp4' }],
        });

        const map = await service.getMap({});

        expect(map.topics[0].words[0].word).toBe('orbit');
        expect(map.topics[0].words[0].due).toBe(true);
        expect(map.topics[0].words[1].due).toBe(false);
    });

    it('没有视频上下文的词进入 looseWords，不丢数据', async () => {
        const service = buildService({
            words: [
                word({ word: 'journey' }),
                word({ word: 'manual', source: 'manual', status: 'known' }),
            ],
            encounters: [encounter({ lemma: 'journey', fileHash: null, videoId: null })],
        });

        const map = await service.getMap({});

        expect(map.topics).toHaveLength(0);
        expect(map.looseWords?.wordCount).toBe(2);
        expect(map.looseWords?.words.map((item) => item.word).sort()).toEqual(['journey', 'manual']);
    });

    it('默认词表不进入图谱，主题数量受 limit 限制', async () => {
        const service = buildService({
            words: [
                word({ word: 'journey' }),
                word({ word: 'defaulted', source: 'default', status: 'ignored' }),
            ],
            encounters: [
                encounter({ lemma: 'journey', videoId: 'video-1' }),
                encounter({ lemma: 'journey', videoId: 'video-2' }),
            ],
            records: [
                { id: 'video-1', file_name: 'one.mp4' },
                { id: 'video-2', file_name: 'two.mp4' },
            ],
        });

        const map = await service.getMap({ limit: 1 });

        expect(map.totalWords).toBe(1);
        expect(map.topics).toHaveLength(1);
        expect(map.looseWords).toBeNull();
    });
});
