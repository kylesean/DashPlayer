import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-topic-embedding-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { TopicEmbeddingServiceImpl } from '@/backend/services/TopicEmbeddingService';
import type TopicVectorRepository from '@/backend/services/repositories/TopicVectorRepository';
import type { TopicVectorRow } from '@/backend/infrastructure/db/tables/topicVector';

const runtime = (embed: (texts: readonly string[]) => Promise<number[][] | null>) => ({ embed });

/**
 * 内存版向量仓储桩：只保留 upsert 与按视频读取，用于验证持久化路径。
 */
const memoryRepository = (initial: TopicVectorRow[] = []) => {
    const rows = new Map<string, TopicVectorRow>();
    for (const row of initial) {
        rows.set(`${row.model}::${row.video_id}`, row);
    }
    const repository = {
        listByModel: vi.fn(async (model: string) =>
            [...rows.values()].filter((row) => row.model === model)),
        listByVideoIds: vi.fn(async (model: string, videoIds: readonly string[]) =>
            videoIds
                .map((id) => rows.get(`${model}::${id}`))
                .filter((row): row is TopicVectorRow => Boolean(row))),
        upsert: vi.fn(async (value) => {
            rows.set(`${value.model}::${value.videoId}`, {
                id: 1,
                video_id: value.videoId,
                model: value.model,
                dimension: value.dimension,
                vector: value.vector,
                text_hash: value.textHash,
                created_at: '',
                updated_at: '',
            });
        }),
        upsertMany: vi.fn(async (values) => {
            for (const value of values) {
                await repository.upsert(value);
            }
        }),
        deleteByModel: vi.fn(async () => 0),
        deleteByVideoIds: vi.fn(async (videoIds: readonly string[]) => {
            let removed = 0;
            for (const key of [...rows.keys()]) {
                if (videoIds.includes(key.split('::')[1])) {
                    rows.delete(key);
                    removed += 1;
                }
            }
            return removed;
        }),
    };
    return { repository: repository as unknown as TopicVectorRepository, rows, spies: repository };
};

describe('TopicEmbeddingService', () => {
    it('相同文本命中缓存，不重复推理', async () => {
        const embed = vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0]));
        const { repository } = memoryRepository();
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never, repository);

        const first = await service.embed([{ id: 'a', text: 'space' }]);
        const second = await service.embed([{ id: 'b', text: 'space' }]);

        expect(first).toEqual([{ id: 'a', vector: [1, 0] }]);
        expect(second).toEqual([{ id: 'b', vector: [1, 0] }]);
        expect(embed).toHaveBeenCalledTimes(1);
    });

    it('模型不可用时返回 null，由调用方降级', async () => {
        const { repository } = memoryRepository();
        const service = new TopicEmbeddingServiceImpl(runtime(async () => null) as never, repository);

        expect(await service.embed([{ id: 'a', text: 'space' }])).toBeNull();
    });

    it('只对未命中缓存的文本发起推理，并保持输入顺序', async () => {
        const embed = vi.fn(async (texts: readonly string[]) =>
            texts.map((text) => (text === 'space' ? [1, 0] : [0, 1])));
        const { repository } = memoryRepository();
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never, repository);

        await service.embed([{ id: 'a', text: 'space' }]);
        const result = await service.embed([
            { id: 'b', text: 'cake' },
            { id: 'a', text: 'space' },
        ]);

        expect(result).toEqual([
            { id: 'b', vector: [0, 1] },
            { id: 'a', vector: [1, 0] },
        ]);
        expect(embed).toHaveBeenCalledTimes(2);
        expect(embed).toHaveBeenLastCalledWith(['cake']);
    });

    it('空输入不触发推理', async () => {
        const embed = vi.fn(async () => []);
        const { repository } = memoryRepository();
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never, repository);

        expect(await service.embed([])).toEqual([]);
        expect(embed).not.toHaveBeenCalled();
    });

    it('新进程（空内存缓存）命中持久化索引，不重复推理', async () => {
        const embed = vi.fn(async (texts: readonly string[]) => texts.map(() => [0, 1]));
        const { repository, spies } = memoryRepository();
        const firstProcess = new TopicEmbeddingServiceImpl(runtime(embed) as never, repository);
        await firstProcess.embed([{ id: 'video-a', text: 'ocean life' }]);
        expect(embed).toHaveBeenCalledTimes(1);

        const secondProcess = new TopicEmbeddingServiceImpl(runtime(embed) as never, repository);
        const result = await secondProcess.embed([{ id: 'video-a', text: 'ocean life' }]);

        expect(result).toEqual([{ id: 'video-a', vector: [0, 1] }]);
        expect(embed).toHaveBeenCalledTimes(1);
        expect(spies.upsertMany).toHaveBeenCalledTimes(1);
    });

    it('主题文本变化时重新推理，不复用旧向量', async () => {
        const embed = vi.fn(async (texts: readonly string[]) =>
            texts.map((text) => (text === 'ocean life' ? [1, 0] : [0, 1])));
        const { repository } = memoryRepository();
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never, repository);

        await service.embed([{ id: 'video-a', text: 'ocean life' }]);
        const result = await service.embed([{ id: 'video-a', text: 'city traffic' }]);

        expect(result).toEqual([{ id: 'video-a', vector: [0, 1] }]);
        expect(embed).toHaveBeenCalledTimes(2);
    });

    it('维度不一致的持久化条目被忽略并重新推理', async () => {
        const embed = vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 1, 1]));
        const { repository } = memoryRepository([{
            id: 1,
            video_id: 'video-a',
            model: 'bge-small-en-v1.5-q8_0',
            dimension: 2,
            vector: Buffer.from(new Float32Array([1, 0]).buffer),
            // 哈希与当前文本不匹配，必须重算；同时维度也不同。
            text_hash: 'stale',
            created_at: '',
            updated_at: '',
        }]);
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never, repository);

        const result = await service.embed([{ id: 'video-a', text: 'ocean life' }]);

        expect(result).toEqual([{ id: 'video-a', vector: [1, 1, 1] }]);
        expect(embed).toHaveBeenCalledTimes(1);
    });

    it('forget 会删除对应视频的持久化向量', async () => {
        const { repository, rows, spies } = memoryRepository();
        const service = new TopicEmbeddingServiceImpl(
            runtime(async (texts) => texts.map(() => [1, 0])) as never,
            repository,
        );
        await service.embed([{ id: 'video-a', text: 'ocean life' }]);
        expect(rows.size).toBe(1);

        const removed = await service.forget(['video-a']);

        expect(removed).toBe(1);
        expect(rows.size).toBe(0);
        expect(spies.deleteByVideoIds).toHaveBeenCalledWith(['video-a']);
    });
});
