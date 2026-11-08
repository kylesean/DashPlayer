import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sentencePracticeRecord } from '@/backend/infrastructure/db/tables/sentencePracticeRecord';
import SentencePracticeRecordRepositoryImpl from '@/backend/infrastructure/db/repositories/SentencePracticeRecordRepositoryImpl';
import { MemoryFileSystemGateway } from '@/test/memory-file-system-gateway';
import { createMemoryDb, type MemoryDb } from '@/test/database';
import type FfmpegService from '@/backend/services/FfmpegService';
import type SpeechRecognitionGateway from '@/backend/services/gateways/media/SpeechRecognitionGateway';
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
    public failWith: Error | null = null;

    public async transcribe(): Promise<{ text: string; tokens: [] }> {
        if (this.failWith) throw this.failWith;
        return { text: this.transcriptText, tokens: [] };
    }

    public cancelActive(): void {}
}

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
            convertToWav: vi.fn().mockResolvedValue(undefined),
        } as unknown as FfmpegService;
        service = new SentencePracticeServiceImpl(
            new SentencePracticeRecordRepositoryImpl(memoryDb.db),
            ffmpegService,
            storageProvider,
            fsGateway,
            new FakeTranscriptionEngineSelector(speechGateway),
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
                resegmented: true,
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
                resegmented: true,
                mode: 'dictation',
                transcript: 'hello word today',
                audio_file: null,
            });
        });
    });

    describe('跟读评分', () => {
        it('录音转写后落库,录音文件随记录留存供回放', async () => {
            speechGateway.transcriptText = EXPECTED_TEXT;
            const vo = await service.scoreShadowing({
                fileHash: FILE_HASH,
                sentenceIndex: 1,
                resegmented: false,
                audio: new Uint8Array([1, 2, 3]),
                expectedText: EXPECTED_TEXT,
            });

            expect(vo.score).toBe(100);
            expect(vo.transcript).toBe(EXPECTED_TEXT);
            expect(vo.audioPath).toContain(practiceRoot);

            const rows = await memoryDb.db.select().from(sentencePracticeRecord);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                sentence_index: 1,
                resegmented: false,
                mode: 'shadowing',
            });
            expect(rows[0].audio_file).not.toBeNull();
            // 录音 webm 确实写到了 practice 目录
            expect(await fsGateway.fileExists(path.join(practiceRoot, rows[0].audio_file!))).toBe(true);
        });

        it('转写链路失败时抛出错误并清理落盘录音', async () => {
            speechGateway.failWith = new Error('asr down');

            await expect(service.scoreShadowing({
                fileHash: FILE_HASH,
                sentenceIndex: 1,
                resegmented: true,
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
        it('同一意群的历史按重切分状态隔离,开关切换后互不串档', async () => {
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
                resegmented: true,
                typedText: EXPECTED_TEXT,
                expectedText: EXPECTED_TEXT,
            });
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
                resegmented: false,
                typedText: 'another typing',
                expectedText: EXPECTED_TEXT,
            });

            const resegmented = await service.listBySentence({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
                resegmented: true,
            });
            const raw = await service.listBySentence({
                fileHash: FILE_HASH,
                sentenceIndex: 2,
                resegmented: false,
            });

            expect(resegmented).toHaveLength(1);
            expect(resegmented[0]).toMatchObject({ sentenceIndex: 2, resegmented: true, transcript: EXPECTED_TEXT });
            expect(raw).toHaveLength(1);
            expect(raw[0]).toMatchObject({ sentenceIndex: 2, resegmented: false, transcript: 'another typing' });
        });

        it('同键历史按时间倒序返回', async () => {
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 5,
                resegmented: true,
                typedText: 'first try',
                expectedText: EXPECTED_TEXT,
            });
            await service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 5,
                resegmented: true,
                typedText: 'second try',
                expectedText: EXPECTED_TEXT,
            });

            const history = await service.listBySentence({
                fileHash: FILE_HASH,
                sentenceIndex: 5,
                resegmented: true,
            });
            expect(history.map((h) => h.transcript)).toEqual(['second try', 'first try']);
        });
    });

    describe('入参校验', () => {
        it('非法 fileHash、序号与重切分标志直接拒绝', async () => {
            await expect(service.scoreDictation({
                fileHash: '../escape',
                sentenceIndex: 0,
                resegmented: true,
                typedText: 'x',
                expectedText: 'x',
            })).rejects.toThrow('非法的 fileHash');

            await expect(service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: -1,
                resegmented: true,
                typedText: 'x',
                expectedText: 'x',
            })).rejects.toThrow('非法的 sentenceIndex');

            await expect(service.scoreDictation({
                fileHash: FILE_HASH,
                sentenceIndex: 0,
                resegmented: 'true' as unknown as boolean,
                typedText: 'x',
                expectedText: 'x',
            })).rejects.toThrow('非法的 resegmented');
        });
    });
});
