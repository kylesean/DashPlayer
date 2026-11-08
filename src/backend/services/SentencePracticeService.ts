import path from 'path';
import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { alignPracticeTokens } from '@/common/utils/practice/pronunciationScoring';
import type {
    SentencePracticeDictationParams,
    SentencePracticeMode,
    SentencePracticeRecordVO,
    SentencePracticeResultVO,
    SentencePracticeShadowingParams,
} from '@/common/contracts/sentence-practice';
import type FfmpegService from '@/backend/services/FfmpegService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type TranscriptionEngineSelector from '@/backend/services/TranscriptionEngineSelector';
import type SentencePracticeRecordRepository from '@/backend/services/repositories/SentencePracticeRecordRepository';

/**
 * 句子跟读/听写练习业务服务。
 *
 * 跟读:MediaRecorder 录音字节 → 临时目录 → ffmpeg 转 16kHz 单声道 WAV →
 * 本地 ASR(whisper.cpp/sherpa-onnx,按设置路由)转写 → 与原句词级对齐评分;
 * 听写:键入文本直接与原句对齐评分。评分共用 common 层确定性算法,不经 LLM。
 */
export default interface SentencePracticeService {
    /**
     * 跟读评分:转写用户录音并与原句对齐,结果落库后返回。
     *
     * @returns 分数、转写文本与逐词对齐结果。
     */
    scoreShadowing(params: SentencePracticeShadowingParams): Promise<SentencePracticeResultVO>;

    /**
     * 听写评分:键入文本与原句对齐,结果落库后返回。
     *
     * @returns 分数、听写输入与逐词对齐结果。
     */
    scoreDictation(params: SentencePracticeDictationParams): Promise<SentencePracticeResultVO>;

    /**
     * 查询单个意群的练习历史,按时间倒序。
     */
    listBySentence(params: { fileHash: string; sentenceIndex: number }): Promise<SentencePracticeRecordVO[]>;
}

/**
 * fileHash 直接拼进临时目录名,只放行无路径语义的字符。
 */
const SAFE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * 单次练习评分服务实现。
 */
@injectable()
export class SentencePracticeServiceImpl implements SentencePracticeService {
    private readonly logger = getMainLogger('SentencePracticeServiceImpl');

    @inject(TYPES.SentencePracticeRecordRepository)
    private repository!: SentencePracticeRecordRepository;

    @inject(TYPES.FfmpegService)
    private ffmpegService!: FfmpegService;

    @inject(TYPES.StorageDirectoryProvider)
    private storageDirectoryProvider!: StorageDirectoryProvider;

    @inject(TYPES.FileSystemGateway)
    private fileSystemGateway!: FileSystemGateway;

    @inject(TYPES.TranscriptionEngineSelector)
    private transcriptionEngineSelector!: TranscriptionEngineSelector;

    public async scoreShadowing(params: SentencePracticeShadowingParams): Promise<SentencePracticeResultVO> {
        const { fileHash, sentenceIndex, audio, expectedText } = params;
        this.validateKeys(fileHash, sentenceIndex);
        const transcript = await this.transcribeRecording(fileHash, sentenceIndex, audio);
        const alignment = alignPracticeTokens(expectedText, transcript);
        await this.persistRecord(fileHash, sentenceIndex, 'shadowing', alignment.score, transcript, alignment.words);
        return { score: alignment.score, transcript, words: alignment.words };
    }

    public async scoreDictation(params: SentencePracticeDictationParams): Promise<SentencePracticeResultVO> {
        const { fileHash, sentenceIndex, typedText, expectedText } = params;
        this.validateKeys(fileHash, sentenceIndex);
        const alignment = alignPracticeTokens(expectedText, typedText);
        await this.persistRecord(fileHash, sentenceIndex, 'dictation', alignment.score, typedText, alignment.words);
        return { score: alignment.score, transcript: typedText, words: alignment.words };
    }

    public async listBySentence(params: { fileHash: string; sentenceIndex: number }): Promise<SentencePracticeRecordVO[]> {
        const { fileHash, sentenceIndex } = params;
        this.validateKeys(fileHash, sentenceIndex);
        const records = await this.repository.listBySentence(fileHash, sentenceIndex);
        return records.map((record) => ({
            id: record.id,
            fileHash: record.file_hash,
            sentenceIndex: record.sentence_index,
            mode: record.mode as SentencePracticeMode,
            score: record.score,
            transcript: record.transcript,
            createdAt: record.created_at,
        }));
    }

    /**
     * 转写录音:webm 落盘临时会话目录 → 16kHz 单声道 WAV → 本地 ASR。
     * 会话目录是纯临时产物,无论成败用完即删。
     */
    private async transcribeRecording(fileHash: string, sentenceIndex: number, audio: Uint8Array): Promise<string> {
        const tempRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.TEMP);
        const sessionDir = path.join(tempRoot, 'practice', `${fileHash}-${sentenceIndex}-${randomUUID()}`);
        await this.fileSystemGateway.ensureDirectory(sessionDir);
        const rawPath = path.join(sessionDir, 'recording.webm');
        const wavPath = path.join(sessionDir, 'recording.wav');
        try {
            await this.fileSystemGateway.writeBinaryFile(rawPath, audio);
            await this.ffmpegService.convertToWav(rawPath, wavPath);
            const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
            const gateway = this.transcriptionEngineSelector.select();
            const result = await gateway.transcribe({
                audioPath: wavPath,
                modelsRoot,
                job: `practice:${fileHash}:${sentenceIndex}`,
            });
            return result.text.trim();
        } finally {
            await this.fileSystemGateway.removeDirectoryIfExists(sessionDir).catch(() => undefined);
        }
    }

    private async persistRecord(
        fileHash: string,
        sentenceIndex: number,
        mode: SentencePracticeMode,
        score: number,
        transcript: string,
        words: SentencePracticeResultVO['words'],
    ): Promise<void> {
        try {
            await this.repository.insertOne({
                file_hash: fileHash,
                sentence_index: sentenceIndex,
                mode,
                score,
                transcript: transcript || null,
                detail_json: JSON.stringify(words),
            });
        } catch (error) {
            // 落库失败不影响本次评分返回(练习结果以实时响应为准),仅记录告警。
            this.logger.warn('failed to persist practice record', { fileHash, sentenceIndex, error });
        }
    }

    private validateKeys(fileHash: string, sentenceIndex: number): void {
        if (!fileHash || !SAFE_KEY_PATTERN.test(fileHash)) {
            throw new Error(`非法的 fileHash: ${fileHash}`);
        }
        if (!Number.isInteger(sentenceIndex) || sentenceIndex < 0) {
            throw new Error(`非法的 sentenceIndex: ${sentenceIndex}`);
        }
    }
}
