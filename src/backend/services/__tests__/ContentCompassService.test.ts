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

const buildHarness = async (): Promise<Harness> => {
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
            shown: 3,
            opened: 1,
            dismissed: 1,
            reviewed: 1,
            openRate: 1 / 3,
            dismissRate: 1 / 3,
            reviewRate: 1,
            retention: { reviewed: 2, retention: 0.5 },
        });
        expect(events).toHaveLength(6);
    });
});
