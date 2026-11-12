import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import LearningDataRepositoryImpl from '@/backend/infrastructure/db/repositories/LearningDataRepositoryImpl';
import WordsRepositoryImpl from '@/backend/infrastructure/db/repositories/WordsRepositoryImpl';
import { productionPracticeRecord } from '@/backend/infrastructure/db/tables/productionPracticeRecord';
import { recommendationEvent } from '@/backend/infrastructure/db/tables/recommendationEvent';
import { reviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import { rolePlayTurn } from '@/backend/infrastructure/db/tables/rolePlayTurn';
import { sentencePracticeRecord } from '@/backend/infrastructure/db/tables/sentencePracticeRecord';
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
    const wordMatchService = {
        invalidateVocabularyCache: vi.fn(),
        getVocabularyRevision: vi.fn(() => 0),
    };
    const subtitleService = {
        invalidateVocabularyAnalysisCache: vi.fn(),
    };
    const service = new LearningDataServiceImpl(
        repository,
        new FileSystemGatewayImpl(),
        wordMatchService as never,
        subtitleService as never,
    );
    return { service, repository, wordsRepository, wordMatchService, subtitleService };
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

        expect(exported.schemaVersion).toBe(3);
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

    it('导出包含跟读、听写与产出型练习，避免清除后无法恢复', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        await seedWords(memoryDb, [
            { word: 'journey', translate: '旅程', status: 'learning', source: 'manual' },
        ]);
        await memoryDb.db.insert(sentencePracticeRecord).values({
            file_hash: 'subtitle-1',
            sentence_index: 3,
            resegmented: false,
            mode: 'shadowing',
            score: 88.5,
            transcript: 'the journey changed everything',
            audio_file: 'practice/a.webm',
            detail_json: '[]',
        });
        await memoryDb.db.insert(productionPracticeRecord).values({
            mode: 'roleplay',
            video_id: 'video-1',
            sentence_text: 'What did you learn?',
            response_text: 'I learned to slow down.',
            level: 'good',
            feedback: 'clear',
            improved: 'I learned to slow down and listen.',
        });
        await memoryDb.db.insert(rolePlayTurn).values({
            session_key: 'video-1|opening',
            turn: 1,
            video_id: 'video-1',
            file_hash: 'subtitle-1',
            partner_line: 'What did you learn?',
            partner_index: 4,
            response_text: 'I learned to slow down.',
            level: 'good',
            feedback: 'clear',
            improved: 'I learned to slow down and listen.',
            used_expressions_json: '["slow down"]',
            source: 'ai',
        });

        const exported = await service.buildExport();

        expect(exported.schemaVersion).toBe(3);
        expect(exported.sentencePractices).toEqual([{
            fileHash: 'subtitle-1',
            sentenceIndex: 3,
            resegmented: false,
            mode: 'shadowing',
            score: 88.5,
            transcript: 'the journey changed everything',
            audioFile: 'practice/a.webm',
            detailJson: '[]',
            createdAt: expect.any(String),
        }]);
        expect(exported.productionPractices).toHaveLength(1);
        expect(exported.productionPractices[0]).toMatchObject({
            mode: 'roleplay',
            videoId: 'video-1',
            level: 'good',
            responseText: 'I learned to slow down.',
        });
        expect(exported.rolePlayTurns).toEqual([{
            sessionKey: 'video-1|opening',
            turn: 1,
            videoId: 'video-1',
            fileHash: 'subtitle-1',
            partnerLine: 'What did you learn?',
            partnerIndex: 4,
            responseText: 'I learned to slow down.',
            level: 'good',
            feedback: 'clear',
            improved: 'I learned to slow down and listen.',
            usedExpressions: ['slow down'],
            source: 'ai',
            createdAt: expect.any(String),
        }]);
    });

    it('导入备份会整体恢复词表、事件、复习卡与练习记录', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const now = new Date().toISOString();
        await seedWords(memoryDb, [
            { word: 'stale', translate: '旧词', status: 'learning', source: 'manual' },
        ]);
        seedEvents(memoryDb, [{ word: 'stale', action: 'save', createdAt: now }]);
        await memoryDb.db.insert(sentencePracticeRecord).values({
            file_hash: 'old',
            sentence_index: 0,
            mode: 'dictation',
            score: 10,
        });

        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-learning-import-'));
        const filePath = path.join(directory, 'backup.json');
        try {
            await fs.writeFile(filePath, JSON.stringify({
                schemaVersion: 2,
                exportedAt: now,
                words: [{
                    word: 'journey',
                    translate: '旅程',
                    status: 'known',
                    source: 'manual',
                    mastery: 0.9,
                    confidence: 0.8,
                    lastSeenAt: now,
                    masteredAt: now,
                    createdAt: now,
                    updatedAt: now,
                }],
                encounters: [{
                    id: 99,
                    word: 'journey',
                    lemma: 'journey',
                    action: 'review',
                    videoId: 'video-1',
                    fileHash: 'subtitle-1',
                    sentenceIndex: 1,
                    sentenceHash: 'hash',
                    context: 'a long journey',
                    score: null,
                    rating: 'good',
                    createdAt: now,
                }],
                reviewCards: [{
                    word: 'journey',
                    dueAt: now,
                    state: 'review',
                    reps: 3,
                    lapses: 1,
                    stability: 4.5,
                    difficulty: 5,
                    lastReviewAt: now,
                    lastRating: 'good',
                    createdAt: now,
                    updatedAt: now,
                }],
                recommendations: [],
                sentencePractices: [{
                    fileHash: 'subtitle-1',
                    sentenceIndex: 2,
                    resegmented: true,
                    mode: 'shadowing',
                    score: 91,
                    transcript: 'the journey',
                    audioFile: null,
                    detailJson: null,
                    createdAt: now,
                }],
                productionPractices: [{
                    mode: 'retell',
                    videoId: 'video-1',
                    fileHash: 'subtitle-1',
                    sentenceIndex: 2,
                    sentenceText: 'The journey changed everything.',
                    responseText: 'Everything changed.',
                    level: 'great',
                    feedback: null,
                    improved: null,
                    detailJson: null,
                    createdAt: now,
                }],
                retention: { last7Days: { reviewed: 0, retention: null }, last30Days: { reviewed: 0, retention: null } },
            }), 'utf8');

            const result = await service.importFromJson(filePath);

            expect(result).toMatchObject({
                success: true,
                wordsRestored: 1,
                encountersRestored: 1,
                reviewCardsRestored: 1,
                sentencePracticesRestored: 1,
                productionPracticesRestored: 1,
            });
            const remainingWords = await memoryDb.db.select().from(words);
            expect(remainingWords.map((word) => word.word)).toEqual(['journey']);
            expect(remainingWords[0]).toMatchObject({ status: 'known', mastery: 0.9, confidence: 0.8 });
            const remainingEncounters = await memoryDb.db.select().from(wordEncounter);
            expect(remainingEncounters).toHaveLength(1);
            expect(remainingEncounters[0]).toMatchObject({ word: 'journey', action: 'review', rating: 'good' });
            expect(await memoryDb.db.select().from(sentencePracticeRecord)).toHaveLength(1);
            expect(await memoryDb.db.select().from(productionPracticeRecord)).toHaveLength(1);
            const cards = await memoryDb.db.select().from(reviewCard);
            expect(cards).toHaveLength(1);
            expect(cards[0]).toMatchObject({ word: 'journey', reps: 3, lapses: 1 });
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('导入备份保留默认词表，并允许备份里的同名词覆盖默认词', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const now = new Date().toISOString();
        await seedWords(memoryDb, [
            { word: 'the', translate: '这个', status: 'ignored', source: 'default' },
        ]);

        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-learning-default-'));
        const filePath = path.join(directory, 'backup.json');
        try {
            await fs.writeFile(filePath, JSON.stringify({
                schemaVersion: 2,
                exportedAt: now,
                words: [{
                    word: 'the',
                    translate: '这个（我自己的）',
                    status: 'learning',
                    source: 'manual',
                    mastery: 0.2,
                    confidence: 0.3,
                    lastSeenAt: null,
                    masteredAt: null,
                    createdAt: now,
                    updatedAt: now,
                }],
                encounters: [],
                reviewCards: [],
                recommendations: [],
                sentencePractices: [],
                productionPractices: [],
            }), 'utf8');

            await service.importFromJson(filePath);

            const remainingWords = await memoryDb.db.select().from(words);
            expect(remainingWords).toHaveLength(1);
            expect(remainingWords[0]).toMatchObject({
                word: 'the',
                source: 'manual',
                status: 'learning',
                translate: '这个（我自己的）',
            });
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('导出后清除再导入，可以完整还原学习数据', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        const now = new Date().toISOString();
        await seedWords(memoryDb, [
            { word: 'journey', translate: '旅程', status: 'known', source: 'manual', mastery: 0.9, confidence: 0.8, masteredAt: now },
            { word: 'orbit', translate: '轨道', status: 'learning', source: 'manual', mastery: 0.3, confidence: 0.4 },
        ]);
        seedCards(memoryDb, [{ word: 'orbit', dueAt: now }]);
        seedEvents(memoryDb, [
            { word: 'journey', action: 'review', createdAt: now, rating: 'good' },
            { word: 'orbit', action: 'shadow', createdAt: now, score: 85 },
        ]);
        await memoryDb.db.insert(sentencePracticeRecord).values({
            file_hash: 'subtitle-1',
            sentence_index: 4,
            mode: 'shadowing',
            score: 85,
            transcript: 'a long journey',
        });
        await memoryDb.db.insert(productionPracticeRecord).values({
            mode: 'retell',
            sentence_text: 'The journey changed everything.',
            response_text: 'Everything changed after the journey.',
            level: 'great',
        });
        await memoryDb.db.insert(rolePlayTurn).values({
            session_key: 'video-1|roundtrip',
            turn: 1,
            partner_line: 'Where did you go?',
            response_text: 'I went on a long journey.',
            level: 'great',
            used_expressions_json: '["go on a journey"]',
            source: 'local',
        });

        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-learning-roundtrip-'));
        const filePath = path.join(directory, 'backup.json');
        try {
            const before = await service.buildExport();
            await service.exportToJson(filePath);
            await service.resetLearningData();

            const cleared = await service.buildExport();
            expect(cleared.encounters).toHaveLength(0);
            expect(cleared.reviewCards).toHaveLength(0);
            expect(cleared.sentencePractices).toHaveLength(0);
            expect(cleared.productionPractices).toHaveLength(0);
            expect(cleared.rolePlayTurns).toHaveLength(0);

            const imported = await service.importFromJson(filePath);
            expect(imported.success).toBe(true);

            const after = await service.buildExport();
            expect(after.words).toEqual(before.words);
            expect(after.encounters).toHaveLength(before.encounters.length);
            expect(after.reviewCards).toEqual(before.reviewCards);
            expect(after.sentencePractices).toEqual(before.sentencePractices);
            expect(after.productionPractices).toEqual(before.productionPractices);
            expect(after.rolePlayTurns).toEqual(before.rolePlayTurns);
            expect(after.retention.last7Days.reviewed).toBe(before.retention.last7Days.reviewed);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('恢复超过 SQLite 绑定参数上限的遭遇事件也能完整入库', async () => {
        memoryDb = createMemoryDb();
        const { service } = buildService(memoryDb);
        await seedWords(memoryDb, [
            { word: 'orbit', translate: '轨道', status: 'learning', source: 'manual' },
        ]);

        const exportVo = await service.buildExport();
        // 3000 行 × 11 列 = 33000 个绑定参数，超过 SQLite 32766 的单语句上限：
        // 不分批的实现在这里抛 too many SQL variables，整个恢复失败。
        const now = Date.now();
        exportVo.encounters = Array.from({ length: 3000 }, (_, index) => ({
            id: 0,
            word: 'orbit',
            lemma: 'orbit',
            action: 'seen' as const,
            videoId: 'video-1',
            fileHash: 'subtitle-1',
            sentenceIndex: index % 100,
            sentenceHash: 'hash-' + Math.floor(index / 100),
            context: null,
            score: null,
            rating: null,
            createdAt: new Date(now - index * 1000).toISOString(),
        }));

        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-learning-restore-batch-'));
        const filePath = path.join(directory, 'backup.json');
        try {
            await fs.writeFile(filePath, JSON.stringify(exportVo), 'utf8');
            const imported = await service.importFromJson(filePath);
            expect(imported.success).toBe(true);
            expect(imported.encountersRestored).toBe(3000);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('导出携带原始 mastery 证据值，备份往返不产生衰减复利', async () => {
        memoryDb = createMemoryDb();
        const { service, repository } = buildService(memoryDb);
        // 30 天前的 last_seen：读取边界会给出按 14 天半衰期衰减后的展示值。
        const lastSeen = new Date(Date.now() - 30 * DAY_MS).toISOString();
        await seedWords(memoryDb, [
            { word: 'orbit', translate: '轨道', status: 'learning', source: 'manual', mastery: 0.9, confidence: 0.8 },
        ]);
        await memoryDb.db.update(words).set({ last_seen_at: lastSeen })
            .where(eq(words.word, 'orbit')).run();

        const before = (await repository.listUserWords())[0];
        const exportVo = await service.buildExport();
        expect(exportVo.words[0].mastery).toBe(0.9);
        expect(exportVo.words[0].lastSeenAt).toBe(lastSeen);

        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-learning-no-double-decay-'));
        const filePath = path.join(directory, 'backup.json');
        try {
            await service.exportToJson(filePath);
            await service.resetLearningData();
            await service.importFromJson(filePath);
            const restored = (await repository.listUserWords())[0];

            // 恢复后的展示值与原库一致：衰减时钟没有被备份导出/导入过程重置或叠加。
            // 两次读取的 Date.now 相差几毫秒，衰减输出有 ~1e-10 抖动；若发生复利
            // （衰减后的值被当作原始值再衰减一次）差异约 0.11，远大于该容差。
            expect(restored.mastery).toBeCloseTo(before.mastery, 4);
            expect(restored.last_seen_at).toBe(lastSeen);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('导入与清除学习数据后失效词表派生缓存', async () => {
        memoryDb = createMemoryDb();
        const { service, wordMatchService, subtitleService } = buildService(memoryDb);
        await seedWords(memoryDb, [
            { word: 'orbit', translate: '轨道', status: 'learning', source: 'manual' },
        ]);

        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-learning-invalidate-'));
        const filePath = path.join(directory, 'backup.json');
        try {
            await service.exportToJson(filePath);
            await service.resetLearningData();
            expect(wordMatchService.invalidateVocabularyCache).toHaveBeenCalledTimes(1);
            expect(subtitleService.invalidateVocabularyAnalysisCache).toHaveBeenCalledTimes(1);

            await service.importFromJson(filePath);
            expect(wordMatchService.invalidateVocabularyCache).toHaveBeenCalledTimes(2);
            expect(subtitleService.invalidateVocabularyAnalysisCache).toHaveBeenCalledTimes(2);
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    it('exportToJson 写入可解析的 JSON 文件', async () => {        memoryDb = createMemoryDb();
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
        await memoryDb.db.insert(sentencePracticeRecord).values({
            file_hash: 'subtitle-1',
            sentence_index: 0,
            mode: 'shadowing',
            score: 90,
        });
        await memoryDb.db.insert(productionPracticeRecord).values({
            mode: 'retell',
            sentence_text: 'The journey changed everything.',
            response_text: 'The journey changed everything for me.',
            level: 'good',
        });
        await memoryDb.db.insert(rolePlayTurn).values({
            session_key: 'video-1|clear',
            turn: 1,
            partner_line: 'What changed?',
            response_text: 'The journey changed everything.',
            level: 'good',
            source: 'ai',
        });
        await memoryDb.db.update(words).set({ updated_at: new Date(0).toISOString() }).run();

        const result = await service.resetLearningData();

        expect(result).toEqual({
            encountersDeleted: 2,
            reviewCardsDeleted: 1,
            recommendationsDeleted: 1,
            rolePlayTurnsDeleted: 1,
            wordsReset: 2,
        });
        expect(await memoryDb.db.select().from(wordEncounter)).toHaveLength(0);
        expect(await memoryDb.db.select().from(reviewCard)).toHaveLength(0);
        expect(await memoryDb.db.select().from(recommendationEvent)).toHaveLength(0);
        expect(await memoryDb.db.select().from(sentencePracticeRecord)).toHaveLength(0);
        expect(await memoryDb.db.select().from(productionPracticeRecord)).toHaveLength(0);
        expect(await memoryDb.db.select().from(rolePlayTurn)).toHaveLength(0);
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
