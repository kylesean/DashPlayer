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

const runtime = (embed: (texts: readonly string[]) => Promise<number[][] | null>) => ({ embed });

describe('TopicEmbeddingService', () => {
    it('相同文本命中缓存，不重复推理', async () => {
        const embed = vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0]));
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never);

        const first = await service.embed([{ id: 'a', text: 'space' }]);
        const second = await service.embed([{ id: 'b', text: 'space' }]);

        expect(first).toEqual([{ id: 'a', vector: [1, 0] }]);
        expect(second).toEqual([{ id: 'b', vector: [1, 0] }]);
        expect(embed).toHaveBeenCalledTimes(1);
    });

    it('模型不可用时返回 null，由调用方降级', async () => {
        const service = new TopicEmbeddingServiceImpl(runtime(async () => null) as never);

        expect(await service.embed([{ id: 'a', text: 'space' }])).toBeNull();
    });

    it('只对未命中缓存的文本发起推理，并保持输入顺序', async () => {
        const embed = vi.fn(async (texts: readonly string[]) =>
            texts.map((text) => (text === 'space' ? [1, 0] : [0, 1])));
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never);

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
        const service = new TopicEmbeddingServiceImpl(runtime(embed) as never);

        expect(await service.embed([])).toEqual([]);
        expect(embed).not.toHaveBeenCalled();
    });
});
