import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import LearningDataRepositoryImpl from '@/backend/infrastructure/db/repositories/LearningDataRepositoryImpl';
import WordsRepositoryImpl from '@/backend/infrastructure/db/repositories/WordsRepositoryImpl';
import { recommendationEvent } from '@/backend/infrastructure/db/tables/recommendationEvent';
import { reviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import { wordEncounter, type InsertWordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { words } from '@/backend/infrastructure/db/tables/words';
import FileSystemGatewayImpl from '@/backend/infrastructure/storage/FileSystemGatewayImpl';
import { LearningDataServiceImpl } from '@/backend/services/LearningDataService';
import { createMemoryDb, type MemoryDb } from '@/test/database';
import type { WordStatus } from '@/common/types/vocabulary';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface SeedWord {
    word: string;
    translate: string;
    status: WordStatus;
    source: 'manual' | 'default';
    mastery?: number;
    confidence?: number;
    masteredAt?: string | null;
}

interface SeedEvent {
    word: string;
    action: InsertWordEncounter['action'];
    createdAt: string;
    videoId?: string;
    fileHash?: string;
    score?: number;
    rating?: InsertWordEncounter['rating'];
}

/**
 * 使用真实内存 SQLite 装配学习数据服务。
 */
const buildService = (memoryDb: MemoryDb) => {
    const repository = new LearningDataRepositoryImpl(memoryDb.db);
    const wordsRepository = new WordsRepositoryImpl(memoryDb.db);
    const service = new LearningDataServiceImpl(repository, new FileSystemGatewayImpl());
    return { service, repository, wordsRepository };
};

/**
 * 直接写入词条，便于构造掌握度与状态组合。
 */
const seedWords = async (memoryDb: MemoryDb, values: SeedWord[]): Promise<void> => {
    const wordsRepository = new WordsRepositoryImpl(memoryDb.db);
    for (const value of values) {
        await wordsRepository.insertOne({
            word: value.word,
            translate: value.translate,
            status: value.status,
            source: value.source,
        });
        await memoryDb.db.update(words).set({
            mastery: value.mastery ?? 0,
            confidence: value.confidence ?? 0,
            mastered_at: value.masteredAt ?? null,
        }).where(eq(words.word, value.word)).run();
    }
};

/**
 * 直接写入遭遇事件，时间由用例控制。
 */
const seedEvents = (memoryDb: MemoryDb, values: SeedEvent[]): void => {
    memoryDb.db.insert(wordEncounter).values(values.map((value) => ({
        word: value.word,
        lemma: value.word.toLowerCase(),
        action: value.action,
        video_id: value.videoId ?? 'video-1',
        file_hash: value.fileHash ?? 'subtitle-1',
        score: value.score ?? null,
        rating: value.rating ?? null,
        created_at: value.createdAt,
    }))).run();
};

/**
 * 直接写入复习卡，到期时间由用例控制。
 */
const seedCards = (memoryDb: MemoryDb, values: Array<{ word: string; dueAt: string }>): void => {
    memoryDb.db.insert(reviewCard).values(values.map((value) => ({
        word: value.word,
        due_at: value.dueAt,
        state: 'new' as const,
        reps: 0,
        lapses: 0,
        stability: 0,
        difficulty: 0,
        last_review_at: null,
        last_rating: null,
        created_at: value.dueAt,
        updated_at: value.dueAt,
    }))).run();
};

describe('LearningDataService 会话摘要', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('统计本次遇到的目标词、已掌握词、到期词与练习次数', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const now = Date.now();
        const since = new Date(now - 2 * HOUR_MS).toISOString();
        await seedWords(memoryDb, [
            { word: 'journey', translate: '旅程', status: 'learning', source: 'manual', mastery: 0.4, confidence: 0.5 },
            { word: 'orbit', translate: '轨道', status: 'known', source: 'manual', mastery: 1, confidence: 1, masteredAt: since },
            { word: 'future', translate: '未来', status: 'familiar', source: 'manual', mastery: 0.6, confidence: 0.7 },
            { word: 'the', translate: '这个', status: 'learning', source: 'default' },
            { word: 'ignore', translate: '忽略', status: 'ignored', source: 'manual' },
            { word: 'unseen', translate: '未见', status: 'learning', source: 'manual' },
        ]);
        const dueAt = new Date(now - HOUR_MS).toISOString();
        const futureDueAt = new Date(now + 2 * DAY_MS).toISOString();
        seedCards(memoryDb, [
            { word: 'journey', dueAt },
            { word: 'future', dueAt: futureDueAt },
            { word: 'unseen', dueAt },
        ]);
        seedEvents(memoryDb, [
            { word: 'journey', action: 'save', createdAt: new Date(now - 100 * 60 * 1000).toISOString() },
            { word: 'journey', action: 'shadow', createdAt: new Date(now - 90 * 60 * 1000).toISOString(), score: 92 },
            { word: 'journey', action: 'review', createdAt: new Date(now - 80 * 60 * 1000).toISOString(), rating: 'good' },
            { word: 'orbit', action: 'known', createdAt: new Date(now - 70 * 60 * 1000).toISOString() },
            { word: 'orbit', action: 'dictation', createdAt: new Date(now - 65 * 60 * 1000).toISOString(), score: 88 },
            { word: 'future', action: 'open', createdAt: new Date(now - 60 * 60 * 1000).toISOString() },
            { word: 'the', action: 'save', createdAt: new Date(now - 50 * 60 * 1000).toISOString() },
            { word: 'ignore', action: 'save', createdAt: new Date(now - 40 * 60 * 1000).toISOString() },
            { word: 'journey', action: 'save', createdAt: new Date(now - 3 * HOUR_MS).toISOString() },
            { word: 'journey', action: 'save', createdAt: new Date(now - 30 * 60 * 1000).toISOString(), videoId: 'video-2' },
        ]);

        const summary = await service.getSessionSummary({
            videoId: 'video-1',
            since,
            limit: 10,
        });

        expect(summary.counts).toEqual({
            encountered: 3,
            mastered: 1,
            due: 1,
            practice: 2,
        });
        expect(summary.words.map((word) => word.word)).toEqual(['future', 'orbit', 'journey']);
        expect(summary.mastered.map((word) => word.word)).toEqual(['orbit']);
        expect(summary.due.map((word) => word.word)).toEqual(['journey']);
        expect(summary.due[0].dueAt).toBe(dueAt);
        expect(summary.due[0].actions).toEqual(['save', 'shadow', 'review']);
        expect(summary.nextDueAt).toBe(dueAt);
    });

    it('没有 videoId 和 fileHash 时返回空摘要', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const since = new Date().toISOString();

        const summary = await service.getSessionSummary({ since });

        expect(summary).toEqual({
            since,
            counts: { encountered: 0, mastered: 0, due: 0, practice: 0 },
            words: [],
            mastered: [],
            due: [],
            nextDueAt: null,
        });
    });

    it('按 fileHash 也能定位会话，并拒绝无效时间', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const now = Date.now();
        await seedWords(memoryDb, [
            { word: 'journey', translate: '旅程', status: 'learning', source: 'manual' },
        ]);
        seedEvents(memoryDb, [
            {
                word: 'journey',
                action: 'open',
                createdAt: new Date(now - 10 * 60 * 1000).toISOString(),
                fileHash: 'subtitle-hash',
            },
        ]);

        const summary = await service.getSessionSummary({
            fileHash: 'subtitle-hash',
            since: new Date(now - HOUR_MS).toISOString(),
        });
        expect(summary.counts.encountered).toBe(1);

        await expect(service.getSessionSummary({ videoId: 'video-1', since: 'not-a-date' }))
            .rejects.toThrow('会话开始时间无效');
    });
});

describe('LearningDataService 导出与清除', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('导出只包含用户词表，并携带事件、复习卡与留存指标', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const now = Date.now();
        await seedWords(memoryDb, [
            { word: 'journey', translate: '旅程', status: 'learning', source: 'manual', mastery: 0.4, confidence: 0.5 },
            { word: 'the', translate: '这个', status: 'learning', source: 'default' },
        ]);
        seedCards(memoryDb, [{ word: 'journey', dueAt: new Date(now - HOUR_MS).toISOString() }]);
        seedEvents(memoryDb, [
            {
                word: 'journey',
                action: 'review',
                createdAt: new Date(now - DAY_MS).toISOString(),
                rating: 'good',
            },
            {
                word: 'journey',
                action: 'review',
                createdAt: new Date(now - 2 * DAY_MS).toISOString(),
                rating: 'again',
            },
        ]);
        await memoryDb.db.insert(recommendationEvent).values({
            video_id: 'video-1',
            action: 'opened',
            surface: 'home',
            score: 0.8,
            reason_code: 'due_review',
        });

        const exported = await service.buildExport();

        expect(exported.schemaVersion).toBe(1);
        expect(exported.words.map((word) => word.word)).toEqual(['journey']);
        expect(exported.words[0]).toMatchObject({
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            mastery: 0.4,
        });
        expect(exported.encounters).toHaveLength(2);
        expect(exported.reviewCards).toHaveLength(1);
        expect(exported.recommendations).toHaveLength(1);
        expect(exported.recommendations[0]).toMatchObject({
            videoId: 'video-1',
            action: 'opened',
            reasonCode: 'due_review',
        });
        expect(exported.retention.last7Days).toEqual({ reviewed: 2, retention: 0.5 });
        expect(exported.retention.last30Days).toEqual({ reviewed: 2, retention: 0.5 });
    });

    it('exportToJson 写入可解析的 JSON 文件', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        await seedWords(memoryDb, [
            { word: 'journey', translate: '旅程', status: 'learning', source: 'manual' },
        ]);
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-learning-data-'));
        const filePath = path.join(directory, 'learning-data.json');

        try {
            const result = await service.exportToJson(filePath);
            const content = await fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(content) as { words: Array<{ word: string }> };

            expect(result.bytes).toBe(Buffer.byteLength(content, 'utf8'));
            expect(parsed.words.map((word) => word.word)).toEqual(['journey']);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('清除学习记录会删除事件与复习卡，但保留词表、释义与用户状态', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const now = new Date().toISOString();
        await seedWords(memoryDb, [
            { word: 'journey', translate: '旅程', status: 'known', source: 'manual', mastery: 1, confidence: 1, masteredAt: now },
            { word: 'the', translate: '这个', status: 'learning', source: 'default' },
        ]);
        seedCards(memoryDb, [{ word: 'journey', dueAt: now }]);
        seedEvents(memoryDb, [
            { word: 'journey', action: 'known', createdAt: now },
            { word: 'journey', action: 'shadow', createdAt: now, score: 90 },
        ]);
        await memoryDb.db.insert(recommendationEvent).values({
            video_id: 'video-1',
            action: 'shown',
            surface: 'home',
            score: 0.5,
            reason_code: 'next_step',
        });
        await memoryDb.db.update(words).set({ updated_at: new Date(0).toISOString() }).run();

        const result = await service.resetLearningData();

        expect(result).toEqual({
            encountersDeleted: 2,
            reviewCardsDeleted: 1,
            recommendationsDeleted: 1,
            wordsReset: 2,
        });
        expect(await memoryDb.db.select().from(wordEncounter)).toHaveLength(0);
        expect(await memoryDb.db.select().from(reviewCard)).toHaveLength(0);
        expect(await memoryDb.db.select().from(recommendationEvent)).toHaveLength(0);
        const remaining = await memoryDb.db.select().from(words);
        expect(remaining).toHaveLength(2);
        expect(remaining.find((word) => word.word === 'journey')).toMatchObject({
            word: 'journey',
            translate: '旅程',
            status: 'known',
            mastery: 0,
            confidence: 0,
            last_seen_at: null,
            mastered_at: null,
        });
        expect(remaining.find((word) => word.word === 'the')).toMatchObject({
            status: 'learning',
            source: 'default',
        });
    });
});
