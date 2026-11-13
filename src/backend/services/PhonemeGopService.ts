import path from 'path';
import { inject, injectable } from 'inversify';
import type * as ort from 'onnxruntime-node';
import TYPES from '@/backend/ioc/types';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import {
    PHONEME_GOP_MODEL_DIRECTORY,
    PHONEME_GOP_MODEL_FILE,
    PHONEME_GOP_VOCAB_FILE,
} from '@/backend/services/models/phonemeGopModel';
import type { PcmAudio } from '@/common/utils/practice/rhythmFeedback';
import {
    ipaToPhonemeTokens,
    logSoftmaxFrames,
    scoreWordsWithCtcGop,
    type WordPhonemeGopOutput,
    type WordPhonemeTarget,
} from '@/common/utils/practice/phonemeGop';

export default interface PhonemeGopService {
    /** 检查离线音素 GOP 模型与词表是否已安装就绪。 */
    isReady(): Promise<boolean>;

    /**
     * 对 16kHz PCM 录音执行离线音素强制对齐与 GOP 评分。
     * 模型未安装或分析失败时返回 null，由上层降级为纯 ASR 评分。
     */
    scoreWords(params: {
        pcm: PcmAudio;
        words: readonly string[];
        lookupPhonetic: (word: string) => string | null;
    }): Promise<WordPhonemeGopOutput[] | null>;
}

@injectable()
export class PhonemeGopServiceImpl implements PhonemeGopService {
    private readonly logger = getMainLogger('PhonemeGopService');
    private session: ort.InferenceSession | null = null;
    private vocab: Record<string, number> | null = null;
    private loadedModelPath: string | null = null;

    constructor(
        @inject(TYPES.StorageDirectoryProvider) private readonly storageDirectoryProvider: StorageDirectoryProvider,
        @inject(TYPES.FileSystemGateway) private readonly fileSystemGateway: FileSystemGateway,
    ) {}

    public async isReady(): Promise<boolean> {
        const paths = await this.resolvePaths();
        const [modelExists, vocabExists] = await Promise.all([
            this.fileSystemGateway.fileExists(paths.modelPath),
            this.fileSystemGateway.fileExists(paths.vocabPath),
        ]);
        return modelExists && vocabExists;
    }

    public async scoreWords(params: {
        pcm: PcmAudio;
        words: readonly string[];
        lookupPhonetic: (word: string) => string | null;
    }): Promise<WordPhonemeGopOutput[] | null> {
        if (params.pcm.samples.length < 1600 || params.words.length === 0) {
            return null;
        }
        try {
            const loaded = await this.ensureLoaded();
            if (!loaded) {
                return null;
            }
            const { session, vocab } = loaded;
            const targets: WordPhonemeTarget[] = [];
            params.words.forEach((word, wordIndex) => {
                const ipa = params.lookupPhonetic(word);
                if (!ipa) return;
                const phonemes = ipaToPhonemeTokens(ipa, vocab);
                if (phonemes.length > 0) {
                    targets.push({ wordIndex, phonemes });
                }
            });
            if (targets.length === 0) {
                return null;
            }

            // Wav2Vec2 标准输入归一化：零均值、单位方差 Float32
            const floatSamples = this.normalizePcmForWav2Vec2(params.pcm.samples);
            const ortModule = await import('onnxruntime-node');
            const inputName = session.inputNames[0] ?? 'input_values';
            const inputTensor = new ortModule.Tensor('float32', floatSamples, [1, floatSamples.length]);
            const outputs = await session.run({ [inputName]: inputTensor });
            const outputName = session.outputNames[0] ?? 'logits';
            const logitsTensor = outputs[outputName];
            if (!logitsTensor || logitsTensor.dims.length < 3) {
                return null;
            }
            const numFrames = Number(logitsTensor.dims[1]);
            const vocabSize = Number(logitsTensor.dims[2]);
            const rawLogits = logitsTensor.data as Float32Array;
            const logProbs = logSoftmaxFrames(rawLogits, numFrames, vocabSize);
            return scoreWordsWithCtcGop(logProbs, numFrames, vocabSize, vocab, targets);
        } catch (error) {
            this.logger.warn('离线音素 GOP 推理失败，自动回退到 ASR 评分', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    private normalizePcmForWav2Vec2(samples: Int16Array): Float32Array {
        const n = samples.length;
        const floats = new Float32Array(n);
        let mean = 0;
        for (let i = 0; i < n; i += 1) {
            const v = samples[i] / 32768;
            floats[i] = v;
            mean += v;
        }
        mean /= n;
        let variance = 0;
        for (let i = 0; i < n; i += 1) {
            const diff = floats[i] - mean;
            variance += diff * diff;
        }
        const std = Math.sqrt(variance / n + 1e-7);
        for (let i = 0; i < n; i += 1) {
            floats[i] = (floats[i] - mean) / std;
        }
        return floats;
    }

    private async resolvePaths(): Promise<{ modelPath: string; vocabPath: string }> {
        const modelsRoot = await this.storageDirectoryProvider.provideDirectory(StorageDirectoryTarget.MODELS);
        const dir = path.join(modelsRoot, PHONEME_GOP_MODEL_DIRECTORY);
        return {
            modelPath: path.join(dir, PHONEME_GOP_MODEL_FILE),
            vocabPath: path.join(dir, PHONEME_GOP_VOCAB_FILE),
        };
    }

    private async ensureLoaded(): Promise<{ session: ort.InferenceSession; vocab: Record<string, number> } | null> {
        const { modelPath, vocabPath } = await this.resolvePaths();
        if (this.session && this.vocab && this.loadedModelPath === modelPath) {
            return { session: this.session, vocab: this.vocab };
        }
        const [modelExists, vocabExists] = await Promise.all([
            this.fileSystemGateway.fileExists(modelPath),
            this.fileSystemGateway.fileExists(vocabPath),
        ]);
        if (!modelExists || !vocabExists) {
            return null;
        }
        const vocabText = await this.fileSystemGateway.readTextFile(vocabPath);
        const vocab = JSON.parse(vocabText) as Record<string, number>;
        const ortModule = await import('onnxruntime-node');
        const session = await ortModule.InferenceSession.create(modelPath, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
        });
        this.session = session;
        this.vocab = vocab;
        this.loadedModelPath = modelPath;
        this.logger.info('离线音素 GOP 模型已加载', { modelPath });
        return { session, vocab };
    }
}
