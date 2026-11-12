import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: { isPackaged: true, getPath: () => '/tmp/dashplayer-context-studio-test' },
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createMemoryDb, type MemoryDb } from '@/test/database';
import SavedSentenceRepositoryImpl from '@/backend/infrastructure/db/repositories/SavedSentenceRepositoryImpl';
import ContextStudioService from '@/backend/services/ContextStudioService';
import MediaPathRegistry from '@/backend/services/MediaPathRegistry';
import { watchHistory } from '@/backend/infrastructure/db/tables/watchHistory';
import { wordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { sentenceTranslates } from '@/backend/infrastructure/db/tables/sentenceTranslates';

describe('ContextStudioService & SavedSentenceRepository', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('收藏、更新、查询与取消收藏金句（零物理切片元数据模型）', async () => {
        memoryDb = createMemoryDb();
        const repo = new SavedSentenceRepositoryImpl(memoryDb.db);
        const service = new ContextStudioService(repo, memoryDb.db);

        await memoryDb.db.insert(watchHistory).values({
            id: 'vid-1',
            base_path: '/videos',
            file_name: 'steve-jobs-stanford.mp4',
            project_type: 1,
            srt_file: '/videos/steve-jobs-stanford.srt',
        });

        const saved = await service.saveSentence({
            sentenceKey: 'hash-1:12',
            videoId: 'vid-1',
            fileHash: 'hash-1',
            sentenceIndex: 12,
            startTime: 45.2,
            endTime: 49.8,
            text: 'Stay hungry, stay foolish.',
            textZh: '求知若饥，虚心若愚。',
            tag: 'expression',
        });

        expect(saved.videoTitle).toBe('steve-jobs-stanford');
        expect(saved.startTime).toBe(45.2);
        expect(saved.endTime).toBe(49.8);
        expect(saved.tag).toBe('expression');

        // 更新笔记与标签
        const updated = await service.updateSavedSentence({
            sentenceKey: 'hash-1:12',
            note: '经典结束语',
            tag: 'general',
        });
        expect(updated?.note).toBe('经典结束语');
        expect(updated?.tag).toBe('general');

        // 查询全部收藏及按视频 ID 查询键
        const all = await service.listSavedSentences();
        expect(all).toHaveLength(1);
        const keys = await service.listSavedKeysByVideo('vid-1');
        expect(keys).toEqual(['hash-1:12']);

        // 取消收藏
        const removed = await service.unsaveSentence('hash-1:12');
        expect(removed).toBe(true);
        expect(await service.listSavedSentences()).toHaveLength(0);
    });

    it('聚合单词在真实视频语境中的出现记录并补齐译文', async () => {
        memoryDb = createMemoryDb();
        const repo = new SavedSentenceRepositoryImpl(memoryDb.db);
        const service = new ContextStudioService(repo, memoryDb.db);

        await memoryDb.db.insert(watchHistory).values({
            id: 'vid-2',
            base_path: '/media/talks',
            file_name: 'serendipity-talk.mkv',
            project_type: 1,
            srt_file: '/media/talks/serendipity-talk.srt',
        });

        await memoryDb.db.insert(wordEncounter).values([
            {
                word: 'serendipity',
                lemma: 'serendipity',
                action: 'lookup',
                video_id: 'vid-2',
                file_hash: 'h-2',
                sentence_index: 5,
                context: 'It was pure serendipity.',
            },
            // 重复句子应被去重
            {
                word: 'serendipity',
                lemma: 'serendipity',
                action: 'save',
                video_id: 'vid-2',
                file_hash: 'h-2',
                sentence_index: 5,
                context: 'It was pure serendipity.',
            },
        ]);

        await memoryDb.db.insert(sentenceTranslates).values({
            sentence: 'It was pure serendipity.',
            translate: '这纯粹是机缘巧合。',
            mode: 'tencent',
        });

        const contexts = await service.getWordContexts('Serendipity');
        expect(contexts).toHaveLength(1);
        expect(contexts[0].videoTitle).toBe('serendipity-talk');
        expect(contexts[0].videoPath).toBe('/media/talks/serendipity-talk.mkv');
        expect(contexts[0].context).toBe('It was pure serendipity.');
        expect(contexts[0].contextZh).toBe('这纯粹是机缘巧合。');

        const readerDocs = await service.listReaderDocuments();
        expect(readerDocs).toHaveLength(1);
        expect(readerDocs[0].videoId).toBe('vid-2');
        expect(readerDocs[0].srtFile).toBe('/media/talks/serendipity-talk.srt');
    });

    it('从字幕文件解析原视频起止时间戳并为收藏金句补充 videoPath 以支持原生音频直播', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dp-ctx-srt-'));
        try {
            const srtPath = path.join(tmpDir, 'talk.srt');
            await fs.writeFile(
                srtPath,
                [
                    '1',
                    '00:00:12,500 --> 00:00:16,200',
                    'It feels like pure serendipity.',
                    '',
                ].join('\n'),
                'utf-8',
            );

            memoryDb = createMemoryDb();
            const repo = new SavedSentenceRepositoryImpl(memoryDb.db);
            const service = new ContextStudioService(repo, memoryDb.db);

            await memoryDb.db.insert(watchHistory).values({
                id: 'vid-native',
                base_path: tmpDir,
                file_name: 'talk.mp4',
                project_type: 1,
                srt_file: srtPath,
            });

            await memoryDb.db.insert(wordEncounter).values({
                word: 'serendipity',
                lemma: 'serendipity',
                action: 'lookup',
                video_id: 'vid-native',
                file_hash: 'h-native',
                sentence_index: 0,
                context: 'It feels like pure serendipity.',
            });

            await service.saveSentence({
                sentenceKey: 'h-native:0',
                videoId: 'vid-native',
                fileHash: 'h-native',
                sentenceIndex: 0,
                startTime: 12.5,
                endTime: 16.2,
                text: 'It feels like pure serendipity.',
            });

            const contexts = await service.getWordContexts('serendipity');
            expect(contexts).toHaveLength(1);
            expect(contexts[0].videoPath).toBe(path.join(tmpDir, 'talk.mp4'));
            expect(contexts[0].startTime).toBeCloseTo(12.5, 2);
            expect(contexts[0].endTime).toBeCloseTo(16.2, 2);

            const savedList = await service.listSavedSentences();
            expect(savedList).toHaveLength(1);
            expect(savedList[0].videoPath).toBe(path.join(tmpDir, 'talk.mp4'));
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('在 srt_file 为空且字幕经过多行意群合并时，仍能发现同名字幕、匹配精确时间区间并授权 mediaPathRegistry', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dp-ctx-merge-'));
        try {
            const videoPath = path.join(tmpDir, 'adhd-doctor.mp4');
            const srtPath = path.join(tmpDir, 'adhd-doctor.en.srt');
            await fs.writeFile(videoPath, '', 'utf-8');
            await fs.writeFile(
                srtPath,
                [
                    '1',
                    '00:01:02,000 --> 00:01:04,000',
                    'synthesize it, figure out where the holes are,',
                    '',
                    '2',
                    '00:01:04,000 --> 00:01:07,500',
                    'and then figure out how to optimize and approach that.',
                    '',
                ].join('\n'),
                'utf-8',
            );

            memoryDb = createMemoryDb();
            const repo = new SavedSentenceRepositoryImpl(memoryDb.db);
            const registry = new MediaPathRegistry();
            const service = new ContextStudioService(repo, memoryDb.db, registry);

            await memoryDb.db.insert(watchHistory).values({
                id: 'vid-adhd',
                base_path: tmpDir,
                file_name: 'adhd-doctor.mp4',
                project_type: 1,
                srt_file: null,
            });

            await memoryDb.db.insert(wordEncounter).values({
                word: 'approach',
                lemma: 'approach',
                action: 'open',
                video_id: 'vid-adhd',
                context: 'synthesize it, figure out where the holes are, and then figure out how to optimize and approach that.',
            });

            const contexts = await service.getWordContexts('approach');
            expect(contexts).toHaveLength(1);
            expect(contexts[0].startTime).toBeCloseTo(62, 1);
            expect(contexts[0].endTime).toBeCloseTo(67.5, 1);
            expect(registry.isAllowed(videoPath)).toBe(true);
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });
});
