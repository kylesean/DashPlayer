import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-diarization-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import {
    SPEAKER_SEGMENTATION_KIND,
    SPEAKER_SEGMENTATION_VERSION,
    SpeakerDiarizationServiceImpl,
} from '@/backend/services/SpeakerDiarizationService';
import type FfmpegService from '@/backend/services/FfmpegService';
import type MediaSignalRepository from '@/backend/services/repositories/MediaSignalRepository';
import type SpeakerDiarizationGateway from '@/backend/services/gateways/media/SpeakerDiarizationGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';

/**
 * 内存版信号仓储桩。
 */
const memoryRepository = () => {
    const rows = new Map<string, { inputHash: string; payload: string }>();
    const keyOf = (videoId: string, kind: string, version: number): string => `${videoId}::${kind}::${version}`;
    const repository = {
        find: vi.fn(async (videoId: string, kind: string, version: number) => {
            const row = rows.get(keyOf(videoId, kind, version));
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
            rows.set(keyOf(value.videoId, value.kind, value.algorithmVersion), {
                inputHash: value.inputHash,
                payload: value.payloadJson,
            });
        }),
        deleteByVideo: vi.fn(async (videoId: string) => {
            let removed = 0;
            for (const key of [...rows.keys()]) {
                if (key.startsWith(`${videoId}::`)) {
                    rows.delete(key);
                    removed += 1;
                }
            }
            return removed;
        }),
        pruneExcept: vi.fn(async () => 0),
    };
    return { repository: repository as unknown as MediaSignalRepository, rows, spies: repository };
};

const stubGateway = (
    segments: Array<{ start: number; end: number; speaker: string }>,
) => ({
    diarize: vi.fn(async () => ({
        segments,
        speakerCount: new Set(segments.map((segment) => segment.speaker)).size,
    })),
    cancelActive: vi.fn(),
}) as unknown as SpeakerDiarizationGateway;

describe('SpeakerDiarizationService', () => {
    let tempDirectory: string | null = null;

    afterEach(async () => {
        if (tempDirectory) {
            await fs.rm(tempDirectory, { recursive: true, force: true });
            tempDirectory = null;
        }
    });

    /**
     * 造一个真实存在的「视频」文件，让输入指纹可以取到大小与修改时间。
     */
    const setupVideo = async (content = 'video-bytes'): Promise<string> => {
        tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-diarization-'));
        const file = path.join(tempDirectory, 'a.mp4');
        await fs.writeFile(file, content);
        return file;
    };

    const build = (
        repository: MediaSignalRepository,
        gateway: SpeakerDiarizationGateway,
    ) => new SpeakerDiarizationServiceImpl(
        gateway,
        {
            convertToWav: vi.fn(async (_input: string, output: string) => {
                await fs.writeFile(output, 'wav');
            }),
        } as unknown as FfmpegService,
        repository,
        {
            provideDirectory: async () => tempDirectory!,
        } as unknown as StorageDirectoryProvider,
    );

    it('首次调用分离并写回索引，第二次命中缓存不再分离', async () => {
        const file = await setupVideo();
        const { repository, rows, spies } = memoryRepository();
        const gateway = stubGateway([
            { start: 0, end: 2, speaker: 'speaker_00' },
            { start: 2, end: 4, speaker: 'speaker_01' },
        ]);
        const service = build(repository, gateway);

        const first = await service.getIntervals(file);
        const second = await service.getIntervals(file);

        expect(first).toEqual([
            { start: 0, end: 2, speaker: 'speaker_00' },
            { start: 2, end: 4, speaker: 'speaker_01' },
        ]);
        expect(second).toEqual(first);
        expect(gateway.diarize).toHaveBeenCalledTimes(1);
        expect(spies.upsert).toHaveBeenCalledTimes(1);
        expect(rows.size).toBe(1);
        expect(spies.upsert.mock.calls[0][0].kind).toBe(SPEAKER_SEGMENTATION_KIND);
        expect(spies.upsert.mock.calls[0][0].algorithmVersion).toBe(SPEAKER_SEGMENTATION_VERSION);
    });

    it('视频文件变化后输入指纹失效，重新分离', async () => {
        const file = await setupVideo('short');
        const { repository } = memoryRepository();
        const gateway = stubGateway([{ start: 0, end: 2, speaker: 'speaker_00' }]);
        const service = build(repository, gateway);

        await service.getIntervals(file);
        // 替换内容并推进修改时间，模拟「同名视频被换掉」。
        await fs.writeFile(file, 'a much longer video payload');
        await fs.utimes(file, new Date(), new Date(Date.now() + 5_000));
        await service.getIntervals(file);

        expect(gateway.diarize).toHaveBeenCalledTimes(2);
    });

    it('分离失败时返回 null，不抛错也不写缓存', async () => {
        const file = await setupVideo();
        const { repository, rows } = memoryRepository();
        const gateway = {
            diarize: vi.fn(async () => {
                throw new Error('model missing');
            }),
            cancelActive: vi.fn(),
        } as unknown as SpeakerDiarizationGateway;
        const service = build(repository, gateway);

        await expect(service.getIntervals(file)).resolves.toBeNull();
        expect(rows.size).toBe(0);
    });

    it('视频文件不存在时返回 null，不触发分离', async () => {
        const { repository } = memoryRepository();
        const gateway = stubGateway([]);
        const service = build(repository, gateway);

        await expect(service.getIntervals('/video/does-not-exist.mp4')).resolves.toBeNull();
        expect(gateway.diarize).not.toHaveBeenCalled();
    });

    it('持久化载荷损坏时按未命中重算', async () => {
        const file = await setupVideo();
        const { repository, spies } = memoryRepository();
        const gateway = stubGateway([{ start: 0, end: 2, speaker: 'speaker_00' }]);
        const service = build(repository, gateway);
        await service.getIntervals(file);

        // 用同一输入指纹写入坏载荷，模拟磁盘损坏。
        const inputHash = spies.upsert.mock.calls[0][0].inputHash;
        await spies.upsert({
            videoId: file,
            kind: SPEAKER_SEGMENTATION_KIND,
            algorithmVersion: SPEAKER_SEGMENTATION_VERSION,
            inputHash,
            payloadJson: '{not json',
        });

        const result = await service.getIntervals(file);

        expect(result).toEqual([{ start: 0, end: 2, speaker: 'speaker_00' }]);
        expect(gateway.diarize).toHaveBeenCalledTimes(2);
    });

    it('并发请求同一视频只分离一次', async () => {
        const file = await setupVideo();
        const { repository } = memoryRepository();
        const gateway = stubGateway([{ start: 0, end: 2, speaker: 'speaker_00' }]);
        const service = build(repository, gateway);

        await Promise.all([service.getIntervals(file), service.getIntervals(file)]);

        expect(gateway.diarize).toHaveBeenCalledTimes(1);
    });

    it('invalidate 删除该视频的声纹缓存', async () => {
        const file = await setupVideo();
        const { repository, rows } = memoryRepository();
        const gateway = stubGateway([{ start: 0, end: 2, speaker: 'speaker_00' }]);
        const service = build(repository, gateway);
        await service.getIntervals(file);

        expect(await service.invalidate(file)).toBe(1);
        expect(rows.size).toBe(0);
    });
});
