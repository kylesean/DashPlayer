import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-content-compass-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { ContentCompassServiceImpl } from '@/backend/services/ContentCompassService';
import type BuiltinDictionaryStore from '@/backend/services/gateways/translate/BuiltinDictionaryStore';
import LearningDataRepositoryImpl from '@/backend/infrastructure/db/repositories/LearningDataRepositoryImpl';
import WatchHistoryRepositoryImpl from '@/backend/infrastructure/db/repositories/WatchHistoryRepositoryImpl';
import { recommendationEvent } from '@/backend/infrastructure/db/tables/recommendationEvent';
import { reviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import { wordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { words } from '@/backend/infrastructure/db/tables/words';
import FileSystemGatewayImpl from '@/backend/infrastructure/storage/FileSystemGatewayImpl';
import MediaPathRegistry from '@/backend/services/MediaPathRegistry';
import { WatchHistoryProjectType } from '@/backend/services/repositories/WatchHistoryRepository';
import { createMemoryDb, type MemoryDb } from '@/test/database';

const SRT_DUE = `1
00:00:01,000 --> 00:00:04,000
The journey begins with a resilient mindset.

2
00:00:04,000 --> 00:00:07,000
Every small step makes the long road easier.
`;

const SRT_OTHER = `1
00:00:01,000 --> 00:00:04,000
A calm mind makes the long road feel lighter.
`;

const dictionary: BuiltinDictionaryStore = {
    lookup: (word: string) => ({
        word,
        tags: ['zk'],
        collins: 5,
        oxford: 1,
        bnc: 100,
    }) as never,
};

interface Harness {
    service: ContentCompassServiceImpl;
    memoryDb: MemoryDb;
    directory: string;
}

const buildHarness = async (
    embedding: {
        embed: (items: ReadonlyArray<{ id: string; text: string }>) => Promise<Array<{ id: string; vector: number[] }> | null>;
        forget: (videoIds: readonly string[]) => Promise<number>;
        pruneExcept: (activeVideoIds: readonly string[]) => Promise<number>;
    } = {
        embed: async () => null,
        forget: async () => 0,
        pruneExcept: async () => 0,
    },
): Promise<Harness> => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-compass-'));
    const memoryDb = createMemoryDb();
    const watchHistoryRepository = new WatchHistoryRepositoryImpl(memoryDb.db);
    const learningDataRepository = new LearningDataRepositoryImpl(memoryDb.db);
    const service = new ContentCompassServiceImpl(
        watchHistoryRepository,
        learningDataRepository,
        new FileSystemGatewayImpl(),
        dictionary,
        new MediaPathRegistry(),
        embedding,
    );
    return { service, memoryDb, directory };
};

const writeMedia = async (
    directory: string,
    fileName: string,
    subtitle: string,
    subtitleName = fileName.replace(/\.mp4$/u, '.srt'),
): Promise<void> => {
    await fs.writeFile(path.join(directory, fileName), 'video');
    await fs.writeFile(path.join(directory, subtitleName), subtitle, 'utf8');
};

const insertHistory = async (
    memoryDb: MemoryDb,
    values: Array<{
        id: string;
        basePath: string;
        fileName: string;
        updatedAt: string;
        position?: number;
        srtFile?: string | null;
    }>,
): Promise<void> => {
    const repository = new WatchHistoryRepositoryImpl(memoryDb.db);
    for (const value of values) {
        await repository.insert({
            id: value.id,
            base_path: value.basePath,
            file_name: value.fileName,
            project_type: WatchHistoryProjectType.FILE,
            current_position: value.position ?? 0,
            srt_file: value.srtFile ?? null,
            updated_at: value.updatedAt,
        });
    }
};

const seedLearning = async (
    memoryDb: MemoryDb,
    word: string,
    dueAt: string,
): Promise<void> => {
    const now = new Date().toISOString();
    await memoryDb.db.insert(words).values({
        word,
        translate: '旅程',
        status: 'learning',
        source: 'manual',
        mastery: 0.3,
        confidence: 0.6,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
    });
    await memoryDb.db.insert(reviewCard).values({
        word,
        due_at: dueAt,
        state: 'new',
        reps: 0,
        lapses: 0,
        stability: 0,
        difficulty: 0,
        created_at: now,
        updated_at: now,
    });
};

describe('ContentCompassService', () => {
    let harness: Harness | null = null;

    afterEach(async () => {
        harness?.memoryDb.close();
        if (harness) {
            await fs.rm(harness.directory, { recursive: true, force: true });
        }
        harness = null;
    });

    it('优先推荐到期词会复现且理解度合适的字幕视频', async () => {
        harness = await buildHarness();
        await writeMedia(harness.directory, 'journey.mp4', SRT_DUE);
        await writeMedia(harness.directory, 'other.mp4', SRT_OTHER);
        await insertHistory(harness.memoryDb, [
            {
                id: 'journey-video',
                basePath: harness.directory,
                fileName: 'journey.mp4',
                updatedAt: new Date().toISOString(),
            },
            {
                id: 'other-video',
                basePath: harness.directory,
                fileName: 'other.mp4',
                updatedAt: new Date(Date.now() - 60_000).toISOString(),
            },
        ]);
        await seedLearning(harness.memoryDb, 'journey', new Date(Date.now() - 60_000).toISOString());

        const result = await harness.service.list({ limit: 2 });

        expect(result.items[0]).toMatchObject({
            videoId: 'journey-video',
            reason: {
                code: 'due_review',
                words: ['journey'],
                dueCount: 1,
            },
        });
        expect(result.items[0].srtFile).toBe(path.join(harness.directory, 'journey.srt'));
        expect(result.items[0].comprehension).toBeGreaterThan(0);
    });

    /**
     * 到期词数必须是「整部视频里有多少到期词会复现」，而不是 30 行抽样里的命中数。
     * 抽样会把 2000 行的视频报成一个与真实值无关的数字，而用户会据此决定看哪一部。
     */
    it('到期词数覆盖整条字幕，不因抽样而漏计', async () => {
        harness = await buildHarness();
        // 到期词只出现在第 150 行：均匀抽样 30 行时它会落在采样点之间。
        const filler = Array.from({ length: 200 }, (_, index) => `${index + 1}
00:00:${String(index % 60).padStart(2, '0')},000 --> 00:00:${String((index + 1) % 60).padStart(2, '0')},500
A simple filler line number ${index} about ordinary daily routine.
`).join('\n');
        const withDueWord = filler.replace(
            'A simple filler line number 150 about ordinary daily routine.',
            'The journey finally reaches its destination after many long delays.',
        );
        await writeMedia(harness.directory, 'long.mp4', withDueWord);
        await insertHistory(harness.memoryDb, [{
            id: 'long-video',
            basePath: harness.directory,
            fileName: 'long.mp4',
            updatedAt: new Date().toISOString(),
        }]);
        await seedLearning(harness.memoryDb, 'journey', new Date(Date.now() - 60_000).toISOString());

        const result = await harness.service.list({ limit: 1 });

        expect(result.items[0].reason.dueCount).toBe(1);
        expect(result.items[0].reason.words).toContain('journey');
    });

    it('近期观看主题相近的候选获得更高的兴趣分', async () => {
        harness = await buildHarness();
        const watched = `1
00:00:01,000 --> 00:00:04,000
The spacecraft entered a stable orbit around the planet.
`;
        const similar = `1
00:00:01,000 --> 00:00:04,000
The spacecraft orbit around the planet stayed stable.
`;
        const different = `1
00:00:01,000 --> 00:00:04,000
My grandmother baked a lemon cake in the kitchen.
`;
        await writeMedia(harness.directory, 'watched.mp4', watched);
        await writeMedia(harness.directory, 'similar.mp4', similar);
        await writeMedia(harness.directory, 'different.mp4', different);
        await insertHistory(harness.memoryDb, [
            {
                id: 'watched',
                basePath: harness.directory,
                fileName: 'watched.mp4',
                updatedAt: new Date().toISOString(),
                position: 120,
            },
            {
                id: 'similar',
                basePath: harness.directory,
                fileName: 'similar.mp4',
                updatedAt: new Date(Date.now() - 1_000).toISOString(),
            },
            {
                id: 'different',
                basePath: harness.directory,
                fileName: 'different.mp4',
                updatedAt: new Date(Date.now() - 2_000).toISOString(),
            },
        ]);

        const result = await harness.service.list({ limit: 3 });
        const byId = new Map(result.items.map((item) => [item.videoId, item]));

        expect(byId.get('similar')!.interest).toBeGreaterThan(byId.get('different')!.interest);
    });

    it('语义模型可用时使用向量兴趣分，而不是词面重合', async () => {
        const embeddedIds: string[] = [];
        harness = await buildHarness({
            embed: async (items) => {
                embeddedIds.push(...items.map((item) => item.id));
                return items.map((item) => ({
                    id: item.id,
                    // 只有「无关主题」与已观看视频同向，词面分支不可能得到这个结果。
                    vector: item.id.endsWith('different.mp4') ? [1, 0, 0]
                        : item.id.endsWith('watched.mp4') ? [1, 0, 0]
                            : [0, 1, 0],
                }));
            },
            forget: async () => 0,
            pruneExcept: async () => 0,
        });
        const watched = `1
00:00:01,000 --> 00:00:04,000
The spacecraft entered a stable orbit around the planet.
`;
        const similar = `1
00:00:01,000 --> 00:00:04,000
The spacecraft orbit around the planet stayed stable.
`;
        const different = `1
00:00:01,000 --> 00:00:04,000
My grandmother baked a lemon cake in the kitchen.
`;
        await writeMedia(harness.directory, 'watched.mp4', watched);
        await writeMedia(harness.directory, 'similar.mp4', similar);
        await writeMedia(harness.directory, 'different.mp4', different);
        await insertHistory(harness.memoryDb, [
            {
                id: 'watched',
                basePath: harness.directory,
                fileName: 'watched.mp4',
                updatedAt: new Date().toISOString(),
                position: 120,
            },
            {
                id: 'similar',
                basePath: harness.directory,
                fileName: 'similar.mp4',
                updatedAt: new Date(Date.now() - 1_000).toISOString(),
            },
            {
                id: 'different',
                basePath: harness.directory,
                fileName: 'different.mp4',
                updatedAt: new Date(Date.now() - 2_000).toISOString(),
            },
        ]);

        const semantic = await harness.service.list({ limit: 3 });
        const semanticById = new Map(semantic.items.map((item) => [item.videoId, item]));

        // 语义分支必须真正参与，而不是静默降级。
        expect(embeddedIds.some((id) => id.endsWith('watched.mp4'))).toBe(true);

        // 同一批数据在词面分支下兴趣分不同，证明排序层确实使用了语义向量。
        harness.memoryDb.close();
        harness = await buildHarness();
        await writeMedia(harness.directory, 'watched.mp4', watched);
        await writeMedia(harness.directory, 'similar.mp4', similar);
        await writeMedia(harness.directory, 'different.mp4', different);
        await insertHistory(harness.memoryDb, [
            {
                id: 'watched',
                basePath: harness.directory,
                fileName: 'watched.mp4',
                updatedAt: new Date().toISOString(),
                position: 120,
            },
            {
                id: 'similar',
                basePath: harness.directory,
                fileName: 'similar.mp4',
                updatedAt: new Date(Date.now() - 1_000).toISOString(),
            },
            {
                id: 'different',
                basePath: harness.directory,
                fileName: 'different.mp4',
                updatedAt: new Date(Date.now() - 2_000).toISOString(),
            },
        ]);
        const lexical = await harness.service.list({ limit: 3 });
        const lexicalById = new Map(lexical.items.map((item) => [item.videoId, item]));

        expect(semanticById.get('different')!.interest)
            .not.toBe(lexicalById.get('different')!.interest);
    });

    it('排除已展示视频后返回下一个候选，没有字幕的视频不参与', async () => {
        harness = await buildHarness();
        await writeMedia(harness.directory, 'first.mp4', SRT_DUE);
        await writeMedia(harness.directory, 'second.mp4', SRT_OTHER);
        await fs.writeFile(path.join(harness.directory, 'silent.mp4'), 'video');
        await insertHistory(harness.memoryDb, [
            {
                id: 'first',
                basePath: harness.directory,
                fileName: 'first.mp4',
                updatedAt: new Date().toISOString(),
            },
            {
                id: 'second',
                basePath: harness.directory,
                fileName: 'second.mp4',
                updatedAt: new Date(Date.now() - 1_000).toISOString(),
            },
            {
                id: 'silent',
                basePath: harness.directory,
                fileName: 'silent.mp4',
                updatedAt: new Date(Date.now() - 2_000).toISOString(),
            },
        ]);

        const result = await harness.service.list({ excludeVideoIds: ['first'], limit: 3 });

        expect(result.items.map((item) => item.videoId)).toEqual(['second']);
    });

    it('前序候选都没有字幕时继续向后寻找，而不是提前返回空结果', async () => {
        harness = await buildHarness();
        const directory = harness.directory;
        const history = Array.from({ length: 13 }, (_, index) => {
            const fileName = `silent-${index}.mp4`;
            return {
                id: `silent-${index}`,
                basePath: directory,
                fileName,
                updatedAt: new Date(Date.now() - index * 1_000).toISOString(),
            };
        });
        for (const entry of history) {
            await fs.writeFile(path.join(directory, entry.fileName), 'video');
        }
        await writeMedia(directory, 'playable.mp4', SRT_OTHER);
        await insertHistory(harness.memoryDb, [
            ...history,
            {
                id: 'playable',
                basePath: directory,
                fileName: 'playable.mp4',
                updatedAt: new Date(Date.now() - 60_000).toISOString(),
            },
        ]);

        const result = await harness.service.list({ limit: 3 });

        expect(result.items.map((item) => item.videoId)).toEqual(['playable']);
    });

    it('汇总曝光、打开、不感兴趣与复习回忆指标', async () => {
        harness = await buildHarness();
        const now = new Date();
        await harness.service.recordEvent({
            videoId: 'video-1',
            action: 'shown',
            surface: 'home',
        });
        await harness.service.recordEvent({
            videoId: 'video-1',
            action: 'opened',
            surface: 'home',
        });
        await harness.service.recordEvent({
            videoId: 'video-2',
            action: 'dismissed',
            surface: 'home',
        });
        await harness.service.recordEvent({
            videoId: 'video-2',
            action: 'shown',
            surface: 'home',
        });
        await harness.service.recordEvent({
            videoId: 'video-1',
            action: 'shown',
            reasonCode: 'due_review',
            surface: 'home',
        });
        await harness.service.recordEvent({
            videoId: 'video-1',
            action: 'reviewed',
            reasonCode: 'due_review',
            surface: 'home',
        });
        await harness.memoryDb.db.insert(wordEncounter).values({
            word: 'journey',
            lemma: 'journey',
            action: 'review',
            rating: 'good',
            created_at: now.toISOString(),
        });
        await harness.memoryDb.db.insert(wordEncounter).values({
            word: 'journey',
            lemma: 'journey',
            action: 'review',
            rating: 'again',
            created_at: now.toISOString(),
        });

        const stats = await harness.service.getStats({ days: 7 });
        const events = await harness.memoryDb.db.select().from(recommendationEvent);

        expect(stats).toMatchObject({
            shown: 2,
            opened: 1,
            dismissed: 1,
            reviewed: 1,
            openRate: 1 / 2,
            dismissRate: 1 / 2,
            reviewRate: 1,
        });
        // 复习成功率不再挂在推荐统计上：它是全站记忆指标，混进来会被读成
        // 「这条推荐让我记住了 X%」，属于范畴错误。
        expect(stats).not.toHaveProperty('retention');
        expect(events).toHaveLength(6);
    });

    it('只有复习晚于推荐进入复习时间才记为回忆', async () => {
        harness = await buildHarness();
        const base = new Date();
        base.setUTCDate(base.getUTCDate() - 1);
        base.setUTCHours(12, 0, 0, 0);
        const at = (offsetMinutes: number): string =>
            new Date(base.getTime() + offsetMinutes * 60_000).toISOString();

        await harness.memoryDb.db.insert(recommendationEvent).values([
            { video_id: 'video-1', action: 'shown', created_at: at(-120) },
            { video_id: 'video-1', action: 'opened', created_at: at(-60) },
            { video_id: 'video-1', action: 'reviewed', created_at: at(0) },
        ]);
        await harness.memoryDb.db.insert(wordEncounter).values({
            word: 'journey',
            lemma: 'journey',
            action: 'review',
            rating: 'good',
            created_at: at(-30),
        });

        const before = await harness.service.getAttribution({ days: 7 });
        expect(before.overall.counts.recalled).toBe(0);

        await harness.memoryDb.db.insert(wordEncounter).values({
            word: 'journey',
            lemma: 'journey',
            action: 'review',
            rating: 'easy',
            created_at: at(30),
        });

        const after = await harness.service.getAttribution({ days: 7 });
        expect(after.overall.counts.recalled).toBe(1);
    });

    it('推荐比率只统计同一曝光样本，重复动作不会把比率推过 100%', async () => {
        harness = await buildHarness();
        await harness.service.recordEvent({ videoId: 'video-1', action: 'shown', reasonCode: 'due_review' });
        await harness.service.recordEvent({ videoId: 'video-1', action: 'shown', reasonCode: 'due_review' });
        await harness.service.recordEvent({ videoId: 'video-1', action: 'opened' });
        await harness.service.recordEvent({ videoId: 'video-1', action: 'opened' });
        await harness.service.recordEvent({ videoId: 'video-1', action: 'reviewed' });
        // 没有任何曝光记录的 reviewed 不计入分子，避免出现无分母归因。
        await harness.service.recordEvent({ videoId: 'video-2', action: 'reviewed', reasonCode: 'due_review' });

        const stats = await harness.service.getStats({ days: 7 });

        expect(stats).toMatchObject({
            shown: 1,
            opened: 1,
            reviewed: 1,
            openRate: 1,
            reviewRate: 1,
        });
    });
});
