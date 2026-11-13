import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sentencePracticeRecord } from '@/backend/infrastructure/db/tables/sentencePracticeRecord';
import SentencePracticeRecordRepositoryImpl from '@/backend/infrastructure/db/repositories/SentencePracticeRecordRepositoryImpl';
import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';
import { createMemoryDb, type MemoryDb } from '@/test/database';
import type FfmpegService from '@/backend/services/FfmpegService';
import type SpeechRecognitionGateway from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import type { SpeechRecognitionToken } from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type TranscriptionEngineSelector from '@/backend/services/TranscriptionEngineSelector';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';
import { SentencePracticeServiceImpl } from '../SentencePracticeService';

// 日志基建依赖 electron app（AppStatePath → app.isPackaged），服务层测试替换为空实现。
vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const FILE_HASH = '0123456789abcdef';
const EXPECTED_TEXT = 'hello world today';
const STORAGE_ROOT = '/virtual-storage';

/**
 * 可编程转写结果（或失败）的识别网关替身。
 */
class FakeSpeechGateway implements SpeechRecognitionGateway {
    public transcriptText = EXPECTED_TEXT;
    public tokens: SpeechRecognitionToken[] = [];
    public failWith: Error | null = null;

    public async transcribe(): Promise<{ text: string; tokens: SpeechRecognitionToken[] }> {
        if (this.failWith) throw this.failWith;
        return { text: this.transcriptText, tokens: this.tokens };
    }

    public cancelActive(): void {}
}

const SAMPLE_RATE = 16000;

/**
 * 生成 16kHz 单声道 16-bit PCM WAV，供节奏分析使用。
 */
const buildWav = (durationSec: number, amplitude: number): Uint8Array => {
    const sampleCount = Math.round(durationSec * SAMPLE_RATE);
    const dataLength = sampleCount * 2;
    const buffer = new Uint8Array(44 + dataLength);
    const view = new DataView(buffer.buffer);
    const writeAscii = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i += 1) {
            buffer[offset + i] = text.charCodeAt(i);
        }
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, dataLength, true);
    for (let i = 0; i < sampleCount; i += 1) {
        view.setInt16(44 + i * 2, i % 2 === 0 ? amplitude : -amplitude, true);
    }
    return buffer;
};

/**
 * 引擎选择器替身：固定返回测试注入的网关。
 */
class FakeTranscriptionEngineSelector implements TranscriptionEngineSelector {
    constructor(private readonly gateway: SpeechRecognitionGateway) {}

    public select(): SpeechRecognitionGateway {
        return this.gateway;
    }

    public currentEngine(): TranscriptionEngine {
        return 'sherpa-onnx';
    }
}

/**
 * 句子练习服务行为测试。
 *
 * 仓储使用真实 SQLite 内存库,评分断言以返回值与落库状态为准;
 * 只有 ffmpeg / ASR / 存储目录这类外部世界依赖使用替身。
 */
describe('句子练习服务', () => {
    let memoryDb: MemoryDb;
    let fsGateway: MemoryFileSystemGateway;
    let speechGateway: FakeSpeechGateway;
    let service: SentencePracticeServiceImpl;
    let practiceRoot: string;

    beforeEach(() => {
        memoryDb = createMemoryDb();
        fsGateway = new MemoryFileSystemGateway();
        speechGateway = new FakeSpeechGateway();
        practiceRoot = path.join(STORAGE_ROOT, StorageDirectoryTarget.PRACTICE);
        const storageProvider = {
            provideDirectory: async (target: StorageDirectoryTarget) => path.join(STORAGE_ROOT, target),
            ensurePathAccessPermissionIfExists: async () => undefined,
        } as unknown as StorageDirectoryProvider;
        const ffmpegService = {
            convertToWav: vi.fn().mockImplementation(async (_input: string, output: string) => {
                await fsGateway.writeBinaryFile(output, buildWav(1.2, 6000));
            }),
        } as unknown as FfmpegService;
        service = new SentencePracticeServiceImpl(
            new SentencePracticeRecordRepositoryImpl(memoryDb.db),
            ffmpegService,
            storageProvider,
            fsGateway,
            new FakeTranscriptionEngineSelector(speechGateway),
            { lookup: () => null } as never,
        );
    });

    afterEach(() => {
        memoryDb.close();
    });

    describe('听写评分', () => {
        it('键入文本与原句对齐评分后落库,可查回逐词结果', async () => {
            const vo = await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 3,
                typedText: 'hello word today',
                expectedText: EXPECTED_TEXT,
            });

            // hello 命中、world/word 判听岔、today 命中
            expect(vo.words.map((w) => w.status)).toEqual(['match', 'sub', 'match']);
            expect(vo.score).toBeGreaterThan(50);
            expect(vo.audioPath).toBeNull();

            const rows = await memoryDb.db.select().from(sentencePracticeRecord);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                file_hash: FILE_HASH,
                sentence_index: 3,
                mode: 'dictation',
                transcript: 'hello word today',
                audio_file: null,
            });
        });
    });

    describe('录音清理', () => {
        it('只删除给定录音及其派生 WAV', async () => {
            const removeSpy = vi.spyOn(fsGateway, 'removeFileIfExists');
            const target = `${FILE_HASH}/recording.webm`;
            const targetAbs = path.join(practiceRoot, target);

            await service.removeRecordings([target]);

            expect(removeSpy).toHaveBeenCalledWith(targetAbs);
            expect(removeSpy).toHaveBeenCalledWith(`${targetAbs}.wav`);
        });

        it('单个文件删除失败不会让清理整体失败', async () => {
            const target = `${FILE_HASH}/locked.webm`;
            vi.spyOn(fsGateway, 'removeFileIfExists').mockRejectedValueOnce(new Error('locked'));

            await expect(service.removeRecordings([target])).resolves.toBeUndefined();
        });

        it('拒绝越界路径，不触碰文件系统', async () => {
            const removeSpy = vi.spyOn(fsGateway, 'removeFileIfExists');

            await service.removeRecordings(['../secret.webm', `${FILE_HASH}/../escape.webm`, '/abs.webm']);

            expect(removeSpy).not.toHaveBeenCalled();
        });
    });

    describe('跟读评分', () => {
        it('录音转写后落库,录音文件随记录留存供回放', async () => {
            speechGateway.transcriptText = EXPECTED_TEXT;
            const vo = await service.scoreShadowing({
                fileHash: FILE_HASH,
                sentenceIndex: 1,
                audio: new Uint8Array([1, 2, 3]),
                expectedText: EXPECTED_TEXT,
                referenceDurationSec: 1.2,
            });

            expect(vo.score).toBe(100);
            expect(vo.transcript).toBe(EXPECTED_TEXT);
            expect(vo.audioPath).toContain(practiceRoot);

            const rows = await memoryDb.db.select().from(sentencePracticeRecord);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                sentence_index: 1,
                mode: 'shadowing',
            });
            expect(rows[0].audio_file).not.toBeNull();
            // 录音 webm 确实写到了 practice 目录
            expect(await fsGateway.fileExists(path.join(practiceRoot, rows[0].audio_file!))).toBe(true);
        });

        it('跟读结果附带本地节奏与重读分布', async () => {
            speechGateway.transcriptText = 'hello world today';
            speechGateway.tokens = [
                { text: ' hello', start: 0, end: 0.4 },
                { text: ' world', start: 0.4, end: 0.8 },
                { text: ' today', start: 0.8, end: 1.2 },
            ];

            const vo = await service.scoreShadowing({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
                audio: new Uint8Array([1, 2, 3]),
                expectedText: EXPECTED_TEXT,
                referenceDurationSec: 1.2,
            });

            expect(vo.rhythm).not.toBeNull();
            expect(vo.rhythm?.words.map((word) => word.word)).toEqual(['hello', 'world', 'today']);
            expect(vo.rhythm?.speechDurationSec).toBeCloseTo(1.2, 1);
            expect(vo.rhythm?.pace).toBe('steady');
        });

        it('节奏分析失败时保留跟读评分，节奏为空', async () => {
            speechGateway.transcriptText = EXPECTED_TEXT;
            speechGateway.tokens = [
                { text: ' hello', start: 0, end: 0.4 },
            ];
            const failingService = new SentencePracticeServiceImpl(
                new SentencePracticeRecordRepositoryImpl(memoryDb.db),
                {
                    convertToWav: vi.fn().mockImplementation(async (_input: string, output: string) => {
                        await fsGateway.writeBinaryFile(output, new Uint8Array([1, 2, 3, 4]));
                    }),
                } as unknown as FfmpegService,
                {
                    provideDirectory: async (target: StorageDirectoryTarget) => path.join(STORAGE_ROOT, target),
                    ensurePathAccessPermissionIfExists: async () => undefined,
                } as unknown as StorageDirectoryProvider,
                fsGateway,
                new FakeTranscriptionEngineSelector(speechGateway),
                { lookup: () => null } as never,
            );

            const vo = await failingService.scoreShadowing({
                fileHash: FILE_HASH,
                sentenceIndex: 3,
                audio: new Uint8Array([1, 2, 3]),
                expectedText: EXPECTED_TEXT,
            });

            expect(vo.score).toBe(100);
            expect(vo.rhythm).toBeNull();
        });

        it('听写结果不带节奏信息', async () => {
            const vo = await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 4,
                typedText: EXPECTED_TEXT,
                expectedText: EXPECTED_TEXT,
            });

            expect(vo.rhythm).toBeNull();
        });

        it('转写链路失败时抛出错误并清理落盘录音', async () => {
            speechGateway.failWith = new Error('asr down');

            await expect(service.scoreShadowing({
                fileHash: FILE_HASH,
                sentenceIndex: 1,
                audio: new Uint8Array([1, 2, 3]),
                expectedText: EXPECTED_TEXT,
            })).rejects.toThrow('asr down');

            // 没有练习记录承载的录音没有留存价值,失败即清理
            expect(fsGateway.binaryFiles.size).toBe(0);
            const rows = await memoryDb.db.select().from(sentencePracticeRecord);
            expect(rows).toHaveLength(0);
        });
    });

    describe('练习历史查询', () => {
        it('同一意群的历史全部返回，不再按切分形态分区', async () => {
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
                typedText: EXPECTED_TEXT,
                expectedText: EXPECTED_TEXT,
            });
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
                typedText: 'another typing',
                expectedText: EXPECTED_TEXT,
            });

            const history = await service.listBySentence({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
            });

            expect(history).toHaveLength(2);
            expect(history.map((item) => item.transcript)).toEqual(['another typing', EXPECTED_TEXT]);
        });

        it('同键历史按时间倒序返回', async () => {
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 5,
                typedText: 'first try',
                expectedText: EXPECTED_TEXT,
            });
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 5,
                typedText: 'second try',
                expectedText: EXPECTED_TEXT,
            });

            const history = await service.listBySentence({
                fileHash: FILE_HASH,
                sentenceIndex: 5,
            });
            expect(history.map((h) => h.transcript)).toEqual(['second try', 'first try']);
        });

        it('整片汇总按意群聚合最高分、练习次数与最近一次模式', async () => {
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 1,
                typedText: 'hello word today',
                expectedText: EXPECTED_TEXT,
            });
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 1,
                typedText: EXPECTED_TEXT,
                expectedText: EXPECTED_TEXT,
            });
            await service.scoreShadowing({
                fileHash: FILE_HASH,
                sentenceIndex: 4,
                audio: new Uint8Array([1, 2, 3]),
                expectedText: EXPECTED_TEXT,
            });

            const summaries = await service.listByFile({
                fileHash: FILE_HASH,
            });

            expect(summaries).toHaveLength(2);
            const first = summaries.find((s) => s.sentenceIndex === 1);
            const second = summaries.find((s) => s.sentenceIndex === 4);
            expect(first).toMatchObject({
                sentenceIndex: 1,
                bestScore: 100,
                attemptCount: 2,
                lastMode: 'dictation',
            });
            expect(second).toMatchObject({
                sentenceIndex: 4,
                bestScore: 100,
                attemptCount: 1,
                lastMode: 'shadowing',
            });
        });
    });

    describe('入参校验', () => {
        it('非法 fileHash 与序号直接拒绝', async () => {
            await expect(service.scoreDictation({
                fileHash: '../escape',
                sentenceIndex: 0,
                typedText: 'x',
                expectedText: 'x',
            })).rejects.toThrow('非法的 fileHash');

            await expect(service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: -1,
                typedText: 'x',
                expectedText: 'x',
            })).rejects.toThrow('非法的 sentenceIndex');
        });
    });

    describe('transcribeOnce 多语种路由', () => {
        it('preferMultilingual 且 SenseVoice 就绪时优先走 SenseVoice 并跳过英文节奏分析', async () => {
            const senseVoiceGateway = new FakeSpeechGateway();
            senseVoiceGateway.transcriptText = '这句里的 break a leg 怎么理解？';
            speechGateway.transcriptText = 'english only fallback';

            const bilingualService = new SentencePracticeServiceImpl(
                new SentencePracticeRecordRepositoryImpl(memoryDb.db),
                {
                    convertToWav: vi.fn().mockImplementation(async (_input: string, output: string) => {
                        await fsGateway.writeBinaryFile(output, buildWav(1.2, 6000));
                    }),
                } as unknown as FfmpegService,
                {
                    provideDirectory: async (target: StorageDirectoryTarget) => path.join(STORAGE_ROOT, target),
                    ensurePathAccessPermissionIfExists: async () => undefined,
                } as unknown as StorageDirectoryProvider,
                fsGateway,
                new FakeTranscriptionEngineSelector(speechGateway),
                { lookup: () => null } as never,
                undefined,
                { getStatus: async () => ({ ready: true } as never) } as never,
                senseVoiceGateway,
            );

            const vo = await bilingualService.transcribeOnce({
                audio: new Uint8Array([1, 2, 3, 4]),
                referenceText: '',
                jobKey: 'chat-dictation',
                preferMultilingual: true,
            });

            expect(vo.transcript).toBe('这句里的 break a leg 怎么理解？');
            expect(vo.rhythm).toBeNull();
        });

        it('SenseVoice 未安装时平滑回退到当前英文识别引擎', async () => {
            const senseVoiceGateway = new FakeSpeechGateway();
            senseVoiceGateway.transcriptText = 'should not run';
            speechGateway.transcriptText = 'what does it mean';

            const fallbackService = new SentencePracticeServiceImpl(
                new SentencePracticeRecordRepositoryImpl(memoryDb.db),
                {
                    convertToWav: vi.fn().mockImplementation(async (_input: string, output: string) => {
                        await fsGateway.writeBinaryFile(output, buildWav(1.2, 6000));
                    }),
                } as unknown as FfmpegService,
                {
                    provideDirectory: async (target: StorageDirectoryTarget) => path.join(STORAGE_ROOT, target),
                    ensurePathAccessPermissionIfExists: async () => undefined,
                } as unknown as StorageDirectoryProvider,
                fsGateway,
                new FakeTranscriptionEngineSelector(speechGateway),
                { lookup: () => null } as never,
                undefined,
                { getStatus: async () => ({ ready: false } as never) } as never,
                senseVoiceGateway,
            );

            const vo = await fallbackService.transcribeOnce({
                audio: new Uint8Array([1, 2, 3, 4]),
                referenceText: '',
                jobKey: 'chat-dictation',
                preferMultilingual: true,
            });

            expect(vo.transcript).toBe('what does it mean');
        });
    });
});
