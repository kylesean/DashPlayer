import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-sentence-practice-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { SentencePracticeServiceImpl } from '@/backend/services/SentencePracticeService';
import type FfmpegService from '@/backend/services/FfmpegService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type TranscriptionEngineSelector from '@/backend/services/TranscriptionEngineSelector';
import type SpeechRecognitionGateway from '@/backend/services/gateways/media/SpeechRecognitionGateway';
import type SentencePracticeRecordRepository from '@/backend/services/repositories/SentencePracticeRecordRepository';

/** 装配纯桩实例:练习服务为属性注入,ASR 与持久化边界直接赋值。 */
const buildService = (options: {
    transcript?: string;
    transcribeError?: Error;
    repository?: Partial<SentencePracticeRecordRepository>;
}) => {
    const service = new SentencePracticeServiceImpl();
    const gateway: SpeechRecognitionGateway = {
        transcribe: vi.fn(async () => {
            if (options.transcribeError) throw options.transcribeError;
            return { text: options.transcript ?? '', tokens: [] };
        }),
        cancelActive: vi.fn(),
    };
    (service as unknown as { transcriptionEngineSelector: TranscriptionEngineSelector }).transcriptionEngineSelector = {
        select: () => gateway,
        currentEngine: () => 'whisper-cpp',
    } as TranscriptionEngineSelector;
    (service as unknown as { ffmpegService: FfmpegService }).ffmpegService = {
        convertToWav: vi.fn(async () => undefined),
    } as unknown as FfmpegService;
    (service as unknown as { storageDirectoryProvider: StorageDirectoryProvider }).storageDirectoryProvider = {
        provideDirectory: vi.fn(async () => '/tmp/practice-test-root'),
    } as unknown as StorageDirectoryProvider;
    (service as unknown as { fileSystemGateway: FileSystemGateway }).fileSystemGateway = {
        ensureDirectory: vi.fn(async () => undefined),
        writeBinaryFile: vi.fn(async () => undefined),
        removeDirectoryIfExists: vi.fn(async () => undefined),
    } as unknown as FileSystemGateway;
    (service as unknown as { repository: SentencePracticeRecordRepository }).repository = {
        insertOne: vi.fn(async () => 1),
        listBySentence: vi.fn(async () => []),
        ...options.repository,
    } as SentencePracticeRecordRepository;
    return service;
};

const SHADOWING_PARAMS = {
    fileHash: 'abc123',
    sentenceIndex: 7,
    audio: new Uint8Array([1, 2, 3]),
    expectedText: 'I like green apples.',
};

describe('句子练习服务:跟读与听写评分', () => {
    it('跟读:录音经转写后与原句对齐评分并落库', async () => {
        const repository = { insertOne: vi.fn(async () => 1) };
        const service = buildService({ transcript: 'I like green apples', repository });

        const result = await service.scoreShadowing(SHADOWING_PARAMS);
        expect(result.score).toBe(100);
        expect(result.transcript).toBe('I like green apples');
        expect(result.words.every((w) => w.status === 'match')).toBe(true);
        expect(repository.insertOne).toHaveBeenCalledWith(expect.objectContaining({
            file_hash: 'abc123',
            sentence_index: 7,
            mode: 'shadowing',
            score: 100,
        }));
    });

    it('听写:键入文本直接对齐评分并落库', async () => {
        const repository = { insertOne: vi.fn(async () => 1) };
        const service = buildService({ repository });

        const result = await service.scoreDictation({
            fileHash: 'abc123',
            sentenceIndex: 7,
            typedText: 'I like apples',
            expectedText: 'I like green apples',
        });
        // 漏 green:(3/4)×100 = 75
        expect(result.score).toBe(75);
        expect(result.transcript).toBe('I like apples');
        expect(repository.insertOne).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dictation', score: 75 }));
    });

    it('ASR 引擎抛错(如模型缺失)时错误原样上抛且不落库', async () => {
        const repository = { insertOne: vi.fn(async () => 1) };
        const service = buildService({
            transcribeError: new Error('whisper.cpp 模型文件缺失：/x.bin，请先在设置中心下载模型'),
            repository,
        });

        await expect(service.scoreShadowing(SHADOWING_PARAMS)).rejects.toThrow('模型文件缺失');
        expect(repository.insertOne).not.toHaveBeenCalled();
    });

    it('非法 fileHash / sentenceIndex 直接拒绝,不触碰 ASR', async () => {
        const service = buildService({ transcript: 'whatever' });
        await expect(service.scoreShadowing({ ...SHADOWING_PARAMS, fileHash: '../evil' })).rejects.toThrow('非法');
        await expect(service.scoreDictation({ fileHash: 'abc', sentenceIndex: -1, typedText: 'x', expectedText: 'x' }))
            .rejects.toThrow('非法');
    });

    it('历史查询走仓储并映射为 VO', async () => {
        const service = buildService({
            repository: {
                listBySentence: vi.fn(async () => [{
                    id: 3,
                    file_hash: 'abc123',
                    sentence_index: 7,
                    mode: 'dictation',
                    score: 88,
                    transcript: 'I like apples',
                    detail_json: null,
                    created_at: '2026-01-01 00:00:00',
                }]),
            },
        });
        const records = await service.listBySentence({ fileHash: 'abc123', sentenceIndex: 7 });
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            id: 3,
            fileHash: 'abc123',
            sentenceIndex: 7,
            mode: 'dictation',
            score: 88,
        });
    });
});
