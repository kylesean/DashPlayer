import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-scene-index-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { SceneIndexServiceImpl } from '@/backend/services/SceneIndexService';
import type SceneIndexRepository from '@/backend/services/repositories/SceneIndexRepository';
import { SCENE_SEGMENTATION_VERSION, type SceneSentence } from '@/common/learning/sceneSegmentation';
import { sceneInputHash } from '@/common/learning/sceneIndexKey';
import type SpeakerDiarizationService from '@/backend/services/SpeakerDiarizationService';
import type VisualSceneService from '@/backend/services/VisualSceneService';
import type ProsodySignalService from '@/backend/services/ProsodySignalService';

/**
 * 声纹服务桩：默认「没有声纹能力」，让切分退回纯文本启发式。
 *
 * @param intervals 可选的声纹区间；传 null 表示不可用。
 * @returns 满足服务契约的桩对象。
 */
const stubDiarization = (
    intervals: Awaited<ReturnType<SpeakerDiarizationService['getIntervals']>> = null,
) => ({
    getIntervals: vi.fn(async () => intervals),
    invalidate: vi.fn(async () => 0),
}) as unknown as SpeakerDiarizationService;

/**
 * 画面切分服务桩：默认「没有画面能力」，让切分退回字幕与声纹信号。
 *
 * @param boundaries 可选的画面切换点；传 null 表示不可用。
 * @returns 满足服务契约的桩对象。
 */
const stubVisualScene = (
    boundaries: Awaited<ReturnType<VisualSceneService['getBoundaries']>> = null,
) => ({
    getBoundaries: vi.fn(async () => boundaries),
    invalidate: vi.fn(async () => 0),
}) as unknown as VisualSceneService;

/**
 * 韵律信号服务桩：默认「没有韵律能力」，让切分退回字幕/声纹/画面信号。
 *
 * @param shifts 可选的韵律突变点；传 null 表示不可用。
 * @returns 满足服务契约的桩对象。
 */
const stubProsody = (
    shifts: Awaited<ReturnType<ProsodySignalService['getShifts']>> = null,
) => ({
    getShifts: vi.fn(async () => shifts),
    invalidate: vi.fn(async () => 0),
}) as unknown as ProsodySignalService;

/**
 * 内存版场景索引仓储桩。
 */
const memoryRepository = (initial: Record<string, string> = {}) => {
    const rows = new Map<string, { fileHash: string; version: number; inputHash: string; json: string }>();
    for (const [key, json] of Object.entries(initial)) {
        const [fileHash, inputHash] = key.split('::');
        rows.set(`${fileHash}::${SCENE_SEGMENTATION_VERSION}`, {
            fileHash,
            version: SCENE_SEGMENTATION_VERSION,
            inputHash,
            json,
        });
    }
    const repository = {
        find: vi.fn(async (fileHash: string, version: number) => {
            const row = rows.get(`${fileHash}::${version}`);
            if (!row) {
                return null;
            }
            return {
                id: 1,
                file_hash: row.fileHash,
                algorithm_version: row.version,
                input_hash: row.inputHash,
                boundaries_json: row.json,
                created_at: '',
                updated_at: '',
            };
        }),
        upsert: vi.fn(async (value: {
            fileHash: string;
            algorithmVersion: number;
            inputHash: string;
            boundariesJson: string;
        }) => {
            rows.set(`${value.fileHash}::${value.algorithmVersion}`, {
                fileHash: value.fileHash,
                version: value.algorithmVersion,
                inputHash: value.inputHash,
                json: value.boundariesJson,
            });
        }),
        deleteByFile: vi.fn(async (fileHash: string) => {
            let removed = 0;
            for (const key of [...rows.keys()]) {
                if (key.startsWith(`${fileHash}::`)) {
                    rows.delete(key);
                    removed += 1;
                }
            }
            return removed;
        }),
    };
    return { repository: repository as unknown as SceneIndexRepository, rows, spies: repository };
};

const sentence = (
    index: number,
    start: number,
    end: number,
    text: string,
    fileHash = 'hash-1',
): SceneSentence => ({ fileHash, index, start, end, text });

describe('SceneIndexService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('首次调用计算边界并写回索引', async () => {
        const { repository, rows, spies } = memoryRepository();
        const service = new SceneIndexServiceImpl(repository, stubDiarization(), stubVisualScene(), stubProsody());
        const sentences = [
            sentence(0, 0, 2, 'The ocean covers most of the planet.'),
            sentence(1, 10, 12, 'She bought a red bicycle yesterday.'),
        ];

        const boundaries = await service.getBoundaries(sentences);

        expect(boundaries.length).toBeGreaterThan(0);
        expect(spies.upsert).toHaveBeenCalledTimes(1);
        expect(rows.size).toBe(1);
    });

    it('输入指纹一致时命中缓存，不重新计算', async () => {
        const sentences = [
            sentence(0, 0, 2, 'The ocean covers most of the planet.'),
            sentence(1, 10, 12, 'She bought a red bicycle yesterday.'),
        ];
        const cached = [{
            sentenceIndex: 1,
            atSec: 10,
            kinds: ['time-gap' as const],
            confidence: 0.9,
        }];
        const { repository, spies } = memoryRepository({
            [`hash-1::${sceneInputHash(sentences)}`]: JSON.stringify(cached),
        });
        const service = new SceneIndexServiceImpl(repository, stubDiarization(), stubVisualScene(), stubProsody());

        const boundaries = await service.getBoundaries(sentences);

        expect(boundaries).toEqual(cached);
        expect(spies.upsert).not.toHaveBeenCalled();
    });

    it('字幕内容变化时指纹失效，重新计算并覆盖', async () => {
        const oldSentences = [
            sentence(0, 0, 2, 'The ocean covers most of the planet.'),
            sentence(1, 10, 12, 'She bought a red bicycle yesterday.'),
        ];
        const { repository, spies } = memoryRepository({
            [`hash-1::${sceneInputHash(oldSentences)}`]: JSON.stringify([{
                sentenceIndex: 1,
                atSec: 10,
                kinds: ['time-gap'],
                confidence: 0.9,
            }]),
        });
        const service = new SceneIndexServiceImpl(repository, stubDiarization(), stubVisualScene(), stubProsody());
        const newSentences = [
            oldSentences[0],
            sentence(1, 3, 5, 'She bought a red bicycle yesterday.'),
        ];

        await service.getBoundaries(newSentences);

        expect(spies.upsert).toHaveBeenCalledTimes(1);
        expect(spies.upsert.mock.calls[0][0].inputHash).toBe(sceneInputHash(newSentences));
    });

    it('持久化 JSON 损坏时按未命中处理并重算', async () => {
        const sentences = [
            sentence(0, 0, 2, 'The ocean covers most of the planet.'),
            sentence(1, 10, 12, 'She bought a red bicycle yesterday.'),
        ];
        const { repository, spies } = memoryRepository({
            [`hash-1::${sceneInputHash(sentences)}`]: '{not json',
        });
        const service = new SceneIndexServiceImpl(repository, stubDiarization(), stubVisualScene(), stubProsody());

        const boundaries = await service.getBoundaries(sentences);

        expect(boundaries.length).toBeGreaterThan(0);
        expect(spies.upsert).toHaveBeenCalledTimes(1);
    });

    it('仓储读取失败时降级为直接计算，不抛错', async () => {
        const repository = {
            find: vi.fn(async () => {
                throw new Error('db locked');
            }),
            upsert: vi.fn(async () => undefined),
            deleteByFile: vi.fn(async () => 0),
        } as unknown as SceneIndexRepository;
        const service = new SceneIndexServiceImpl(repository, stubDiarization(), stubVisualScene(), stubProsody());

        const boundaries = await service.getBoundaries([
            sentence(0, 0, 2, 'The ocean covers most of the planet.'),
            sentence(1, 10, 12, 'She bought a red bicycle yesterday.'),
        ]);

        expect(boundaries.length).toBeGreaterThan(0);
    });

    it('句数不足或字幕哈希不一致时不做缓存读写', async () => {
        const { repository, spies } = memoryRepository();
        const service = new SceneIndexServiceImpl(repository, stubDiarization(), stubVisualScene(), stubProsody());

        expect(await service.getBoundaries([sentence(0, 0, 2, 'Only one.')])).toEqual([]);
        await service.getBoundaries([
            sentence(0, 0, 2, 'First.', 'hash-a'),
            sentence(1, 10, 12, 'Second.', 'hash-b'),
        ]);

        expect(spies.find).not.toHaveBeenCalled();
        expect(spies.upsert).not.toHaveBeenCalled();
    });

    it('invalidate 删除该字幕的全部版本', async () => {
        const { repository, rows, spies } = memoryRepository();
        const service = new SceneIndexServiceImpl(repository, stubDiarization(), stubVisualScene(), stubProsody());
        await service.getBoundaries([
            sentence(0, 0, 2, 'The ocean covers most of the planet.'),
            sentence(1, 10, 12, 'She bought a red bicycle yesterday.'),
        ]);

        const removed = await service.invalidate('hash-1');

        expect(removed).toBe(1);
        expect(rows.size).toBe(0);
        expect(spies.deleteByFile).toHaveBeenCalledWith('hash-1');
    });

    it('提供视频路径时用真实声纹判定换人，且声纹进入输入指纹', async () => {
        const { repository, spies } = memoryRepository();
        const diarization = stubDiarization([
            { start: 0, end: 2, speaker: 'speaker_00' },
            { start: 2, end: 4, speaker: 'speaker_01' },
        ]);
        const service = new SceneIndexServiceImpl(repository, diarization, stubVisualScene(), stubProsody());
        const sentences = [
            sentence(0, 0, 2, 'Are you ready for the journey?'),
            sentence(1, 2, 4, 'Yes.'),
        ];

        const boundaries = await service.getBoundaries(sentences, '/video/a.mp4');

        expect(diarization.getIntervals).toHaveBeenCalledWith('/video/a.mp4');
        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds).toContain('speaker-shift');
        // 声纹置信度高于文本启发式的 0.45。
        expect(boundaries[0].confidence).toBeGreaterThan(0.45);
        expect(spies.upsert.mock.calls[0][0].inputHash).toBe(sceneInputHash(sentences, [
            { start: 0, end: 2, speaker: 'speaker_00' },
            { start: 2, end: 4, speaker: 'speaker_01' },
        ]));
    });

    it('声纹不可用时退回文本启发式，不因缺少模型而失败', async () => {
        const { repository } = memoryRepository();
        const service = new SceneIndexServiceImpl(repository, stubDiarization(null), stubVisualScene(), stubProsody());
        const sentences = [
            sentence(0, 0, 2, 'The journey starts tomorrow morning.'),
            sentence(1, 2, 4, 'Are you ready for the journey?'),
            sentence(2, 4, 4.6, 'Yes.'),
        ];

        const boundaries = await service.getBoundaries(sentences, '/video/a.mp4');

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds).toContain('speaker-shift');
        expect(boundaries[0].confidence).toBeLessThanOrEqual(0.45);
    });

    it('画面切换点落在句间时标记 visual-shift，并进入输入指纹', async () => {
        const { repository, spies } = memoryRepository();
        const visualScene = stubVisualScene([{ atSec: 4, similarity: 0.79 }]);
        const service = new SceneIndexServiceImpl(repository, stubDiarization(null), visualScene, stubProsody());
        const sentences = [
            sentence(0, 0, 4, 'The journey begins at the station.'),
            sentence(1, 4, 8, 'The journey continues through the valley.'),
        ];

        const boundaries = await service.getBoundaries(sentences, '/video/a.mp4');

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds).toContain('visual-shift');
        expect(spies.upsert.mock.calls[0][0].inputHash).toBe(sceneInputHash(sentences, [], [4]));
    });

    it('韵律突变点标记 prosody-shift，并进入输入指纹', async () => {
        const { repository, spies } = memoryRepository();
        const prosody = stubProsody([{ sentenceIndex: 1, atSec: 4, reason: 'rate', detail: 2.1 }]);
        const service = new SceneIndexServiceImpl(
            repository,
            stubDiarization(null),
            stubVisualScene(),
            prosody,
        );
        const sentences = [
            sentence(0, 0, 4, 'The journey begins at the station.'),
            sentence(1, 4, 8, 'The journey continues through the valley.'),
        ];

        const boundaries = await service.getBoundaries(sentences, '/video/a.mp4');

        expect(prosody.getShifts).toHaveBeenCalledWith('/video/a.mp4', sentences);
        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds).toContain('prosody-shift');
        expect(spies.upsert.mock.calls[0][0].inputHash).toBe(sceneInputHash(
            sentences,
            [],
            [],
            [{ sentenceIndex: 1, atSec: 4, reason: 'rate', detail: 2.1 }],
        ));
    });

    it('韵律信号不可用时不影响其余信号', async () => {
        const { repository } = memoryRepository();
        const service = new SceneIndexServiceImpl(
            repository,
            stubDiarization(null),
            stubVisualScene(),
            stubProsody(null),
        );
        const sentences = [
            sentence(0, 0, 2, 'The ocean covers most of the planet.'),
            sentence(1, 10, 12, 'She bought a red bicycle yesterday.'),
        ];

        const boundaries = await service.getBoundaries(sentences, '/video/a.mp4');

        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].kinds).toContain('time-gap');
        expect(boundaries[0].kinds).not.toContain('prosody-shift');
    });
});
