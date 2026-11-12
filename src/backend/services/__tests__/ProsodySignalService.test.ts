import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-prosody-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import {
    PROSODY_SIGNAL_KIND,
    PROSODY_SIGNAL_VERSION,
    ProsodySignalServiceImpl,
} from '@/backend/services/ProsodySignalService';
import type FfmpegService from '@/backend/services/FfmpegService';
import type MediaSignalRepository from '@/backend/services/repositories/MediaSignalRepository';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type { SceneSentence } from '@/common/learning/sceneSegmentation';

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

/**
 * 生成 16kHz 单声道 16-bit PCM WAV。
 *
 * @param pattern 每段持续秒数，正值为有声、负值为静音。
 * @returns 完整的 WAV 字节。
 */
const wav = (pattern: readonly number[]): Buffer => {
    const sampleRate = 16000;
    const samples: number[] = [];
    for (const seconds of pattern) {
        const count = Math.round(Math.abs(seconds) * sampleRate);
        const value = seconds > 0 ? 16000 : 0;
        for (let index = 0; index < count; index += 1) {
            samples.push(index % 2 === 0 ? value : -value);
        }
    }
    const dataLength = samples.length * 2;
    const buffer = Buffer.alloc(44 + dataLength);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    samples.forEach((sample, index) => {
        buffer.writeInt16LE(sample, 44 + index * 2);
    });
    return buffer;
};

const sentence = (index: number, start: number, end: number, text: string): SceneSentence => ({
    fileHash: 'hash-1',
    index,
    start,
    end,
    text,
});

describe('ProsodySignalService', () => {
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
        tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-prosody-'));
        const file = path.join(tempDirectory, 'a.mp4');
        await fs.writeFile(file, content);
        return file;
    };

    const build = (
        repository: MediaSignalRepository,
        audio: Buffer | Error = wav([1, -0.4, 1, -0.4, 1]),
    ) => new ProsodySignalServiceImpl(
        {
            convertToWav: vi.fn(async (_input: string, output: string) => {
                if (audio instanceof Error) {
                    throw audio;
                }
                await fs.writeFile(output, audio);
            }),
        } as unknown as FfmpegService,
        repository,
        {
            provideDirectory: async () => tempDirectory!,
        } as unknown as StorageDirectoryProvider,
    );

    it('首次调用解码并写回包络，第二次命中缓存不再解码', async () => {
        const file = await setupVideo();
        const { repository, rows, spies } = memoryRepository();
        const service = build(repository);
        const sentences = [
            sentence(0, 0, 1, 'We should leave before the storm arrives.'),
            sentence(1, 1.4, 2.4, 'The wind is getting stronger now.'),
        ];

        const first = await service.getShifts(file, sentences);
        const second = await service.getShifts(file, sentences);

        expect(first).toEqual(second);
        expect(spies.upsert).toHaveBeenCalledTimes(1);
        expect(rows.size).toBe(1);
        expect(spies.upsert.mock.calls[0][0].kind).toBe(PROSODY_SIGNAL_KIND);
        expect(spies.upsert.mock.calls[0][0].algorithmVersion).toBe(PROSODY_SIGNAL_VERSION);
        const payload = JSON.parse(spies.upsert.mock.calls[0][0].payloadJson);
        expect(payload.frameSec).toBe(0.1);
        expect(Array.isArray(payload.envelope)).toBe(true);
    });

    it('缓存命中时按当前字幕重新对齐，不重跑解码', async () => {
        const file = await setupVideo();
        const { repository } = memoryRepository();
        const convertToWav = vi.fn(async (_input: string, output: string) => {
            await fs.writeFile(output, wav([1, -0.4, 1]));
        });
        const service = new ProsodySignalServiceImpl(
            { convertToWav } as unknown as FfmpegService,
            repository,
            { provideDirectory: async () => tempDirectory! } as unknown as StorageDirectoryProvider,
        );
        await service.getShifts(file, [sentence(0, 0, 1, 'We should leave before the storm arrives.')]);

        // 字幕重新校对后句子切分变了，但仍应复用同一份包络。
        await service.getShifts(file, [
            sentence(0, 0, 0.5, 'We should leave.'),
            sentence(1, 0.5, 1, 'Before the storm arrives.'),
        ]);

        expect(convertToWav).toHaveBeenCalledTimes(1);
    });

    it('解码失败时返回 null，不写缓存', async () => {
        const file = await setupVideo();
        const { repository, rows } = memoryRepository();
        const service = build(repository, new Error('no audio stream'));

        await expect(service.getShifts(file, [
            sentence(0, 0, 2, 'hello there my friend'),
            sentence(1, 2, 4, 'goodbye my dear friend'),
        ])).resolves.toBeNull();
        expect(rows.size).toBe(0);
    });

    it('非 16kHz 单声道 WAV 时返回 null', async () => {
        const file = await setupVideo();
        const { repository } = memoryRepository();
        const service = build(repository, Buffer.from('not a wav file at all'));

        await expect(service.getShifts(file, [
            sentence(0, 0, 2, 'hello there my friend'),
            sentence(1, 2, 4, 'goodbye my dear friend'),
        ])).resolves.toBeNull();
    });

    it('视频文件不存在时返回 null，不触发解码', async () => {
        const { repository, spies } = memoryRepository();
        const service = build(repository);

        await expect(service.getShifts('/video/does-not-exist.mp4', [
            sentence(0, 0, 2, 'hello there friend'),
            sentence(1, 2, 4, 'goodbye my friend'),
        ])).resolves.toBeNull();
        expect(spies.upsert).not.toHaveBeenCalled();
    });

    it('句数不足时直接返回空数组', async () => {
        const { repository, spies } = memoryRepository();
        const service = build(repository);

        await expect(service.getShifts('/video/a.mp4', [sentence(0, 0, 2, 'hello')])).resolves.toEqual([]);
        expect(spies.find).not.toHaveBeenCalled();
    });

    it('持久化载荷损坏时按未命中重算', async () => {
        const file = await setupVideo();
        const { repository, spies } = memoryRepository();
        const service = build(repository);
        const sentences = [
            sentence(0, 0, 1, 'We should leave before the storm arrives.'),
            sentence(1, 1.4, 2.4, 'The wind is getting stronger now.'),
        ];
        await service.getShifts(file, sentences);

        const inputHash = spies.upsert.mock.calls[0][0].inputHash;
        await spies.upsert({
            videoId: file,
            kind: PROSODY_SIGNAL_KIND,
            algorithmVersion: PROSODY_SIGNAL_VERSION,
            inputHash,
            payloadJson: '{"frameSec":0.1,"envelope":["oops"]}',
        });

        await service.getShifts(file, sentences);

        // 首次计算 1 次 + 手工写入坏载荷 1 次 + 重算覆盖 1 次。
        expect(spies.upsert).toHaveBeenCalledTimes(3);
    });

    it('invalidate 删除该视频的信号', async () => {
        const file = await setupVideo();
        const { repository, rows } = memoryRepository();
        const service = build(repository);
        await service.getShifts(file, [
            sentence(0, 0, 1, 'We should leave before the storm arrives.'),
            sentence(1, 1.4, 2.4, 'The wind is getting stronger now.'),
        ]);

        await expect(service.invalidate(file)).resolves.toBe(1);
        expect(rows.size).toBe(0);
    });
});
