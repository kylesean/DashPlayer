import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-visual-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import {
    detectSceneChanges,
    pickSampleTimes,
    VISUAL_SCENE_KIND,
    VISUAL_SCENE_VERSION,
    VisualSceneServiceImpl,
} from '@/backend/services/VisualSceneService';
import type { LocalEmbeddingRuntime } from '@/backend/infrastructure/ai/LocalEmbeddingRuntime';
import type FfmpegService from '@/backend/services/FfmpegService';
import type MediaSignalRepository from '@/backend/services/repositories/MediaSignalRepository';
import type { SceneSentence } from '@/common/learning/sceneSegmentation';

const sentence = (index: number, start: number, end: number): SceneSentence => ({
    fileHash: 'hash-1',
    index,
    start,
    end,
    text: 'line',
});

/**
 * 内存版信号仓储桩。
 */
const memoryRepository = () => {
    const rows = new Map<string, { inputHash: string; payload: string }>();
    const repository = {
        find: vi.fn(async (videoId: string, kind: string, version: number) => {
            const row = rows.get(`${videoId}::${kind}::${version}`);
            if (!row) return null;
            return {
                id: 1,
                video_id: videoId,
                kind,
                algorithm_version: version,
                input_hash: row.inputHash,
                payload_json: row.payload,
                created_at: '',
                updated_at: '',
            };
        }),
        upsert: vi.fn(async (value: {
            videoId: string;
            kind: string;
            algorithmVersion: number;
            inputHash: string;
            payloadJson: string;
        }) => {
            rows.set(`${value.videoId}::${value.kind}::${value.algorithmVersion}`, {
                inputHash: value.inputHash,
                payload: value.payloadJson,
            });
        }),
        deleteByVideo: vi.fn(async () => 0),
        pruneExcept: vi.fn(async () => 0),
    };
    return { repository: repository as unknown as MediaSignalRepository, rows, spies: repository };
};

describe('pickSampleTimes', () => {
    it('取每句中点，并按最小间隔去重', () => {
        const times = pickSampleTimes([
            sentence(0, 0, 2),
            sentence(1, 2, 4),
            sentence(2, 20, 22),
        ]);

        // 前两句中点相距 2s（< 8s），只保留第一个。
        expect(times).toEqual([1, 21]);
    });

    it('超过上限时按比例抽稀，覆盖整部视频', () => {
        const many = Array.from({ length: 400 }, (_, index) => sentence(index, index * 10, index * 10 + 9));
        const times = pickSampleTimes(many);

        expect(times.length).toBeLessThanOrEqual(60);
        // 覆盖到视频尾部，而不是只分析开头。
        expect(times[times.length - 1]).toBeGreaterThan(3000);
    });

    it('没有字幕句时返回空数组', () => {
        expect(pickSampleTimes([])).toEqual([]);
    });
});

describe('detectSceneChanges', () => {
    it('相似度低于阈值处标记切换点', () => {
        const boundaries = detectSceneChanges([
            { time: 0, vector: [1, 0, 0] },
            { time: 10, vector: [1, 0, 0] },
            { time: 20, vector: [0, 1, 0] },
        ]);

        expect(boundaries).toEqual([{ atSec: 20, similarity: 0 }]);
    });

    it('维度不一致或零向量按不相似处理，不抛错', () => {
        const boundaries = detectSceneChanges([
            { time: 0, vector: [1, 0] },
            { time: 5, vector: [1, 0, 0] },
            { time: 10, vector: [0, 0] },
        ]);

        expect(boundaries.map((boundary) => boundary.atSec)).toEqual([5, 10]);
    });
});

describe('VisualSceneServiceImpl', () => {
    let tempDirectory: string | null = null;

    afterEach(async () => {
        if (tempDirectory) {
            await fs.rm(tempDirectory, { recursive: true, force: true });
            tempDirectory = null;
        }
    });

    const setupVideo = async (): Promise<string> => {
        tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-visual-'));
        const file = path.join(tempDirectory, 'a.mp4');
        await fs.writeFile(file, 'video-bytes');
        return file;
    };

    /**
     * 抽帧桩：按时间点造出真实文件，让服务能读到字节。
     */
    const stubFfmpeg = (times: number[]) => ({
        extractFrames: vi.fn(async (args: { outputFolder: string }) => {
            const outputs: Array<{ time: number; path: string }> = [];
            for (const [index, time] of times.entries()) {
                const filePath = path.join(args.outputFolder, `frame_${index + 1}.jpg`);
                await fs.writeFile(filePath, `frame-${index}`);
                outputs.push({ time, path: filePath });
            }
            return outputs;
        }),
    }) as unknown as FfmpegService;

    const stubEmbedding = (vectors: number[][], ready = true) => ({
        isMultimodalReady: vi.fn(async () => ready),
        embedImages: vi.fn(async () => vectors),
    }) as unknown as LocalEmbeddingRuntime;

    const build = (
        repository: MediaSignalRepository,
        embedding: LocalEmbeddingRuntime,
        ffmpeg: FfmpegService,
    ) => new VisualSceneServiceImpl(embedding, ffmpeg, repository);

    it('抽帧后按向量突变产出切换点并写回索引', async () => {
        const file = await setupVideo();
        const { repository, rows, spies } = memoryRepository();
        const ffmpeg = stubFfmpeg([1, 21, 41]);
        const embedding = stubEmbedding([[1, 0], [1, 0], [0, 1]]);
        const service = build(repository, embedding, ffmpeg);
        const sentences = [sentence(0, 0, 2), sentence(1, 20, 22), sentence(2, 40, 42)];

        const boundaries = await service.getBoundaries(file, sentences);

        expect(boundaries).toEqual([{ atSec: 41, similarity: 0 }]);
        expect(spies.upsert.mock.calls[0][0].kind).toBe(VISUAL_SCENE_KIND);
        expect(spies.upsert.mock.calls[0][0].algorithmVersion).toBe(VISUAL_SCENE_VERSION);
        expect(rows.size).toBe(1);
    });

    it('多模态投影未安装时返回 null，且不抽帧', async () => {
        const file = await setupVideo();
        const { repository } = memoryRepository();
        const ffmpeg = stubFfmpeg([1, 21]);
        const service = build(repository, stubEmbedding([], false), ffmpeg);

        await expect(service.getBoundaries(file, [sentence(0, 0, 2), sentence(1, 20, 22)]))
            .resolves.toBeNull();
        expect(ffmpeg.extractFrames).not.toHaveBeenCalled();
    });

    it('命中缓存时不重复抽帧与推理', async () => {
        const file = await setupVideo();
        const { repository } = memoryRepository();
        const ffmpeg = stubFfmpeg([1, 21]);
        const embedding = stubEmbedding([[1, 0], [0, 1]]);
        const service = build(repository, embedding, ffmpeg);
        const sentences = [sentence(0, 0, 2), sentence(1, 20, 22)];

        const first = await service.getBoundaries(file, sentences);
        const second = await service.getBoundaries(file, sentences);

        expect(second).toEqual(first);
        expect(ffmpeg.extractFrames).toHaveBeenCalledTimes(1);
        expect(embedding.embedImages).toHaveBeenCalledTimes(1);
    });

    it('抽帧或推理失败时返回 null，不写缓存', async () => {
        const file = await setupVideo();
        const { repository, rows } = memoryRepository();
        const ffmpeg = {
            extractFrames: vi.fn(async () => {
                throw new Error('decode failed');
            }),
        } as unknown as FfmpegService;
        const service = build(repository, stubEmbedding([[1, 0]]), ffmpeg);

        await expect(service.getBoundaries(file, [sentence(0, 0, 2), sentence(1, 20, 22)]))
            .resolves.toBeNull();
        expect(rows.size).toBe(0);
    });

    it('帧数不足两个时返回空数组（无法比较相邻画面）', async () => {
        const file = await setupVideo();
        const { repository } = memoryRepository();
        const service = build(repository, stubEmbedding([[1, 0]]), stubFfmpeg([1]));

        await expect(service.getBoundaries(file, [sentence(0, 0, 2)]))
            .resolves.toEqual([]);
    });
});
