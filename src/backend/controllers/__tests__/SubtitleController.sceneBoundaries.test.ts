import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-subtitle-controller-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import SubtitleController from '@/backend/controllers/SubtitleController';
import type SceneIndexService from '@/backend/services/SceneIndexService';
import type { SceneBoundary, SceneSentence } from '@/common/learning/sceneSegmentation';

/**
 * 构造只提供场景索引的最小控制器。
 *
 * 该用例只验证控制器如何把 IPC 入参交给服务、以及返回值如何透传；
 * 切分与缓存语义由 SceneIndexService 自己的测试覆盖。
 */
const build = (getBoundaries: SceneIndexService['getBoundaries']) => {
    const sceneIndexService = { getBoundaries, invalidate: vi.fn(async () => 0) };
    const controller = new SubtitleController(
        {} as never,
        {} as never,
        sceneIndexService as unknown as SceneIndexService,
    );
    return { controller, sceneIndexService };
};

const sentences: SceneSentence[] = [
    { fileHash: 'hash-1', index: 0, start: 0, end: 2, text: 'The ocean covers most of the planet.' },
    { fileHash: 'hash-1', index: 1, start: 10, end: 12, text: 'She bought a red bicycle.' },
];

describe('SubtitleController 场景边界', () => {
    it('把字幕句原样交给场景索引服务并返回结果', async () => {
        const boundaries: SceneBoundary[] = [{
            sentenceIndex: 1,
            atSec: 10,
            kinds: ['time-gap'],
            confidence: 0.9,
        }];
        const { controller, sceneIndexService } = build(vi.fn(async () => boundaries));

        const result = await controller.getSceneBoundaries({ sentences });

        expect(result).toEqual(boundaries);
        expect(sceneIndexService.getBoundaries).toHaveBeenCalledWith(sentences);
    });

    it('服务返回空数组时透传，不伪造提示', async () => {
        const { controller } = build(vi.fn(async () => []));

        await expect(controller.getSceneBoundaries({ sentences })).resolves.toEqual([]);
    });

    it('服务抛错时向上传播，由 IPC 层统一记录', async () => {
        const { controller } = build(vi.fn(async () => {
            throw new Error('index unavailable');
        }));

        await expect(controller.getSceneBoundaries({ sentences }))
            .rejects.toThrow('index unavailable');
    });
});
