import path from 'path';
import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import { alignPracticeTokens } from '@/common/utils/practice/pronunciationScoring';
import { buildRhythmFeedback, decodePcm16Wav, type RhythmToken } from '@/common/utils/practice/rhythmFeedback';
import type {
    SentencePracticeDictationParams,
    SentencePracticeMode,
    SentencePracticeRecordVO,
    SentencePracticeResultVO,
    SentencePracticeRhythmFeedback,
    SentencePracticeShadowingParams,
    SentencePracticeSummaryVO,
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
 * 跟读:MediaRecorder 录音字节 → practice 持久目录 → ffmpeg 转 16kHz 单声道 WAV →
 * 本地 ASR(whisper.cpp/sherpa-onnx,按设置路由)转写 → 与原句词级对齐评分;
 * 录音 webm 随练习记录留存供回放,评分链路失败时清理落盘文件。
 * 听写:键入文本直接与原句对齐评分。评分共用 common 层确定性算法,不经 LLM。
 */
export default interface SentencePracticeService {
    /**
     * 跟读评分:转写用户录音并与原句对齐,结果落库后返回。
     *
     * @returns 分数、转写文本、逐词对齐结果与录音回放路径。
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
    listBySentence(params: { fileHash: string; sentenceIndex: number; resegmented: boolean }): Promise<SentencePracticeRecordVO[]>;

    /**
     * 查询整片各意群的练习摘要(最高分、总次数、最近一次模式)。
     */
    listByFile(params: { fileHash: string; resegmented: boolean }): Promise<SentencePracticeSummaryVO[]>;
}

/**
 * fileHash 直接拼进临时目录名,只放行无路径语义的字符。
 */
const SAFE_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * 纯点号路径段：`.`、`..`、`...` 等。
 *
 * 上面的字符表允许点号，而 fileHash 会直接拼成 `${fileHash}/${uuid}.webm`，
 * 于是 `..` 能让 path.join 逃出练习目录一级。这类段没有任何合法用途，
 * 一律拒掉。
 */
const DOT_ONLY_SEGMENT_PATTERN = /^\.+$/;

/**
 * 单次练习评分服务实现。
 */
@injectable()
export class SentencePracticeServiceImpl implements SentencePracticeService {
    private readonly logger = getMainLogger('SentencePracticeServiceImpl');

    constructor(
        @inject(TYPES.SentencePracticeRecordRepository) private readonly repository: SentencePracticeRecordRepository,
        @inject(TYPES.FfmpegService) private readonly ffmpegService: FfmpegService,
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
        @inject(TYPES.TranscriptionEngineSelector) private readonly transcriptionEngineSelector: TranscriptionEngineSelector,
    ) {}

    public async scoreShadowing(params: SentencePracticeShadowingParams): Promise<SentencePracticeResultVO> {
        const { fileHash, sentenceIndex, resegmented, audio, expectedText, referenceDurationSec } = params;
        this.validateKeys(fileHash, sentenceIndex, resegmented);
        const { transcript, audioFile, rhythm } = await this.transcribeRecording(
            fileHash,
            sentenceIndex,
            audio,
            expectedText,
            referenceDurationSec,
        );
        const alignment = alignPracticeTokens(expectedText, transcript);
        await this.persistRecord(fileHash, sentenceIndex, resegmented, 'shadowing', alignment.score, transcript, alignment.words, audioFile);
        return {
            score: alignment.score,
            transcript,
            words: alignment.words,
            audioPath: await this.resolveAudioPath(audioFile),
            rhythm,
        };
    }

    public async scoreDictation(params: SentencePracticeDictationParams): Promise<SentencePracticeResultVO> {
        const { fileHash, sentenceIndex, resegmented, typedText, expectedText } = params;
        this.validateKeys(fileHash, sentenceIndex, resegmented);
        const alignment = alignPracticeTokens(expectedText, typedText);
        await this.persistRecord(fileHash, sentenceIndex, resegmented, 'dictation', alignment.score, typedText, alignment.words, null);
        return { score: alignment.score, transcript: typedText, words: alignment.words, audioPath: null, rhythm: null };
    }

    public async listBySentence(params: { fileHash: string; sentenceIndex: number; resegmented: boolean }): Promise<SentencePracticeRecordVO[]> {
        const { fileHash, sentenceIndex, resegmented } = params;
        this.validateKeys(fileHash, sentenceIndex, resegmented);
        const records = await this.repository.listBySentence(fileHash, sentenceIndex, resegmented);
        return Promise.all(records.map(async (record) => ({
            id: record.id,
            fileHash: record.file_hash,
            sentenceIndex: record.sentence_index,
            resegmented: record.resegmented,
            mode: record.mode as SentencePracticeMode,
            score: record.score,
            transcript: record.transcript,
            audioPath: record.audio_file ? await this.resolveAudioPath(record.audio_file) : null,
            createdAt: record.created_at,
        })));
    }

    public async listByFile(params: { fileHash: string; resegmented: boolean }): Promise<SentencePracticeSummaryVO[]> {
        const { fileHash, resegmented } = params;
        this.validateFileKeys(fileHash, resegmented);
        const records = await this.repository.listByFile(fileHash, resegmented);
        const byIndex = new Map<number, SentencePracticeSummaryVO>();
        // 仓储按 id 倒序返回,因此首次遇到的记录就是该意群最近一次练习。
        for (const record of records) {
            const existing = byIndex.get(record.sentence_index);
            if (!existing) {
                byIndex.set(record.sentence_index, {
                    sentenceIndex: record.sentence_index,
                    bestScore: record.score,
                    attemptCount: 1,
                    lastMode: record.mode as SentencePracticeMode,
                    lastPracticedAt: record.created_at,
                });
            } else {
                existing.bestScore = Math.max(existing.bestScore, record.score);
                existing.attemptCount += 1;
            }
        }
        return Array.from(byIndex.values());
    }

    /**
     * 转写录音:webm 直接落盘到 practice 持久目录(评分成功即随记录留存供回放)
     * → 同目录派生 16kHz 单声道 WAV → 本地 ASR。评分链路任何一步失败都清掉落盘文件;
     * 成功则只保留原始 webm(派生 wav 用完即删)。
     *
     * @returns 转写文本与录音在 practice 目录下的相对路径。
     */
    private async transcribeRecording(
        fileHash: string,
        sentenceIndex: number,
        audio: Uint8Array,
        expectedText: string,
        referenceDurationSec?: number,
    ): Promise<{ transcript: string; audioFile: string; rhythm: SentencePracticeRhythmFeedback | null }> {
        const practiceRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.PRACTICE);
        const audioFile = `${fileHash}/${randomUUID()}.webm`;
        const audioAbs = path.join(practiceRoot, audioFile);
        const wavPath = `${audioAbs}.wav`;
        try {
            await this.fileSystemGateway.ensureDirectory(path.dirname(audioAbs));
            await this.fileSystemGateway.writeBinaryFile(audioAbs, audio);
            await this.ffmpegService.convertToWav(audioAbs, wavPath);
            const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
            const gateway = this.transcriptionEngineSelector.select();
            const result = await gateway.transcribe({
                audioPath: wavPath,
                modelsRoot,
                job: `practice:${fileHash}:${sentenceIndex}:${randomUUID()}`,
            });
            const rhythm = await this.analyzeRhythm(
                wavPath,
                expectedText,
                result.text.trim(),
                result.tokens,
                referenceDurationSec,
            );
            return { transcript: result.text.trim(), audioFile, rhythm };
        } catch (error) {
            // 没有练习记录承载的录音没有留存价值,评分失败即清理
            await this.fileSystemGateway.removeFileIfExists(audioAbs).catch(() => undefined);
            throw error;
        } finally {
            await this.fileSystemGateway.removeFileIfExists(wavPath).catch(() => undefined);
        }
    }

    /**
     * 读取转写用的 16kHz WAV，生成节奏与重读分布。
     *
     * 节奏是附加信号：解析或分析失败时返回 null，不影响跟读评分本身。
     */
    private async analyzeRhythm(
        wavPath: string,
        expectedText: string,
        transcript: string,
        tokens: RhythmToken[],
        referenceDurationSec?: number,
    ): Promise<SentencePracticeRhythmFeedback | null> {
        try {
            const buffer = await this.fileSystemGateway.readBinaryFile(wavPath);
            const pcm = decodePcm16Wav(buffer);
            if (!pcm) {
                return null;
            }
            return buildRhythmFeedback({
                expectedText,
                transcript,
                tokens,
                pcm,
                referenceDurationSec,
            });
        } catch (error) {
            this.logger.warn('跟读节奏分析失败，跳过附加信号', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    private async resolveAudioPath(audioFile: string): Promise<string> {
        const practiceRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.PRACTICE);
        return path.join(practiceRoot, audioFile);
    }

    private async persistRecord(
        fileHash: string,
        sentenceIndex: number,
        resegmented: boolean,
        mode: SentencePracticeMode,
        score: number,
        transcript: string,
        words: SentencePracticeResultVO['words'],
        audioFile: string | null,
    ): Promise<void> {
        try {
            await this.repository.insertOne({
                file_hash: fileHash,
                sentence_index: sentenceIndex,
                resegmented,
                mode,
                score,
                transcript: transcript || null,
                audio_file: audioFile,
                detail_json: JSON.stringify(words),
            });
        } catch (error) {
            // 落库失败不影响本次评分返回(练习结果以实时响应为准),仅记录告警。
            this.logger.warn('failed to persist practice record', { fileHash, sentenceIndex, error });
        }
    }

    private validateFileKeys(fileHash: string, resegmented: boolean): void {
        if (!fileHash || !SAFE_KEY_PATTERN.test(fileHash) || DOT_ONLY_SEGMENT_PATTERN.test(fileHash)) {
            throw new Error(`非法的 fileHash: ${fileHash}`);
        }
        // IPC 类型只是编译期约束,外部输入进入业务前按约定做运行时校验
        if (typeof resegmented !== 'boolean') {
            throw new Error(`非法的 resegmented: ${resegmented}`);
        }
    }

    private validateKeys(fileHash: string, sentenceIndex: number, resegmented: boolean): void {
        this.validateFileKeys(fileHash, resegmented);
        if (!Number.isInteger(sentenceIndex) || sentenceIndex < 0) {
            throw new Error(`非法的 sentenceIndex: ${sentenceIndex}`);
        }
    }
}
